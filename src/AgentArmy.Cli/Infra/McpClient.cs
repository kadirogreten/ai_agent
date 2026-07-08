using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;

namespace AgentArmy.Cli;

/// <summary>Bir MCP aracının tanımı: tools/list yanıtından parse edilir.</summary>
public sealed record McpToolDef(
    string      Name,
    string      Description,
    JsonElement InputSchema
);

/// <summary>HTTP transport üzerinden JSON-RPC 2.0 MCP istemcisi.</summary>
public interface IMcpClient
{
    Task<IReadOnlyList<McpToolDef>> ListToolsAsync(CancellationToken ct);
    Task<JsonElement>               CallToolAsync(string toolName, JsonElement args, CancellationToken ct);
}

/// <summary>
/// HTTP transport MCP istemcisi.
/// Lazy initialize: ilk ListToolsAsync / CallToolAsync çağrısında
///   initialize → notifications/initialized handshake yapılır (tek seferlik).
///
/// Null-safe: endpoint erişilemezse McpException fırlatır; çağrıcı ToolResult.Failure'a sarar.
/// Timeout: ctor'da verilen saniye (varsayılan 60 sn, policy mcp.call_timeout_seconds ile ayarlanabilir).
/// </summary>
public sealed class McpClient : IMcpClient, IDisposable
{
    private readonly string     _endpoint;
    private readonly string?    _authEnv;
    private readonly Func<CancellationToken, Task<string?>>? _bearerProvider;
    private readonly HttpClient _http;
    private int  _requestId = 0;
    private bool _initialized;
    private readonly SemaphoreSlim _initLock = new(1, 1);

    public McpClient(string endpoint, string? authEnv = null, int timeoutSeconds = 60)
        : this(endpoint, authEnv, bearerProvider: null, timeoutSeconds) { }

    /// <summary>
    /// PR-S7a: bearerProvider varsa her istekte çağrılır (owner DB token + env fallback).
    /// Yoksa authEnv statik env fallback (mevcut demo akışı).
    /// </summary>
    public McpClient(
        string endpoint,
        string? authEnv,
        Func<CancellationToken, Task<string?>>? bearerProvider,
        int timeoutSeconds = 60)
    {
        _endpoint       = endpoint.TrimEnd('/');
        _authEnv        = authEnv;
        _bearerProvider = bearerProvider;

        _http = new HttpClient(HttpClientPool.SharedHandler, disposeHandler: false)
        {
            Timeout = TimeSpan.FromSeconds(timeoutSeconds),
        };
    }

    public async Task<IReadOnlyList<McpToolDef>> ListToolsAsync(CancellationToken ct)
    {
        await EnsureInitializedAsync(ct);
        var result = await RpcAsync("tools/list", null, ct);
        var tools  = new List<McpToolDef>();

        if (result.TryGetProperty("tools", out var arr) && arr.ValueKind == JsonValueKind.Array)
        {
            foreach (var t in arr.EnumerateArray())
            {
                var name = t.TryGetProperty("name", out var n) && n.ValueKind == JsonValueKind.String
                    ? n.GetString() ?? "" : "";
                if (string.IsNullOrWhiteSpace(name)) continue;

                var desc = t.TryGetProperty("description", out var d) && d.ValueKind == JsonValueKind.String
                    ? d.GetString() ?? "" : "";

                // inputSchema → JSON Schema; yoksa minimal nesne şeması döndür.
                var schema = t.TryGetProperty("inputSchema", out var s)
                    ? s.Clone()
                    : JsonSerializer.SerializeToElement(new { type = "object", properties = new { } });

                tools.Add(new McpToolDef(name, desc, schema));
            }
        }

        return tools;
    }

    public async Task<JsonElement> CallToolAsync(string toolName, JsonElement args, CancellationToken ct)
    {
        await EnsureInitializedAsync(ct);
        var result = await RpcAsync("tools/call", new
        {
            name      = toolName,
            arguments = args.ValueKind == JsonValueKind.Undefined ? (object)new { } : args,
        }, ct);

        // MCP tools/call yanıtı: { content: [...] } veya { result: ... }
        if (result.TryGetProperty("content", out var content)) return content.Clone();
        if (result.TryGetProperty("result",  out var inner))  return inner.Clone();
        return result.Clone();
    }

    // ── Handshake ─────────────────────────────────────────────────────────────

    private async Task EnsureInitializedAsync(CancellationToken ct)
    {
        if (_initialized) return;
        await _initLock.WaitAsync(ct);
        try
        {
            if (_initialized) return;

            // JSON-RPC initialize
            await RpcAsync("initialize", new
            {
                protocolVersion = "2024-11-05",
                capabilities    = new { tools = new { } },
                clientInfo      = new { name = "AgentArmy.McpClient", version = "1.0" },
            }, ct);

            // notifications/initialized — JSON-RPC notification (id yok), best-effort.
            var notif = JsonSerializer.Serialize(new
            {
                jsonrpc = "2.0",
                method  = "notifications/initialized",
                @params = new { },
            });
            try
            {
                using var notifReq = new HttpRequestMessage(HttpMethod.Post, _endpoint)
                {
                    Content = new StringContent(notif, Encoding.UTF8, "application/json"),
                };
                await ApplyBearerAsync(notifReq, ct);
                using var _ = await _http.SendAsync(notifReq,
                    HttpCompletionOption.ResponseHeadersRead, ct);
            }
            catch
            {
                // Notification best-effort; bazı sunucular 204/boş yanıt döner.
            }

            _initialized = true;
        }
        finally
        {
            _initLock.Release();
        }
    }

    // ── JSON-RPC 2.0 ──────────────────────────────────────────────────────────

    private async Task<JsonElement> RpcAsync(string method, object? @params, CancellationToken ct)
    {
        var id      = Interlocked.Increment(ref _requestId);
        var payload = JsonSerializer.Serialize(new
        {
            jsonrpc = "2.0",
            id,
            method,
            @params = @params ?? (object)new { },
        });

        using var req = new HttpRequestMessage(HttpMethod.Post, _endpoint)
        {
            Content = new StringContent(payload, Encoding.UTF8, "application/json"),
        };
        await ApplyBearerAsync(req, ct);

        HttpResponseMessage resp;
        try
        {
            resp = await _http.SendAsync(req, ct);
        }
        catch (TaskCanceledException ex) when (!ct.IsCancellationRequested)
        {
            throw new McpException($"MCP çağrısı zaman aşımına uğradı ({method}): {ex.Message}");
        }

        using (resp)
        {
            var body = await resp.Content.ReadAsStringAsync(ct);
            if (!resp.IsSuccessStatusCode)
                throw new McpException(
                    $"MCP HTTP {(int)resp.StatusCode} ({method}): {body.AsSpan(0, Math.Min(body.Length, 300))}");

            using var doc  = JsonDocument.Parse(body);
            var root = doc.RootElement;

            // JSON-RPC hata yanıtı
            if (root.TryGetProperty("error", out var err))
            {
                var msg  = err.TryGetProperty("message", out var m) ? m.GetString() : null;
                var code = err.TryGetProperty("code", out var c) && c.TryGetInt32(out var ci) ? ci : 0;
                throw new McpException($"MCP JSON-RPC hatası [{code}] ({method}): {msg ?? "bilinmeyen hata"}");
            }

            // result veya tüm yanıt
            return root.TryGetProperty("result", out var result)
                ? result.Clone()
                : root.Clone();
        }
    }

    private async Task ApplyBearerAsync(HttpRequestMessage req, CancellationToken ct)
    {
        string? token = null;
        if (_bearerProvider is not null)
            token = await _bearerProvider(ct);
        if (string.IsNullOrWhiteSpace(token) && _authEnv is not null)
            token = Environment.GetEnvironmentVariable(_authEnv);
        if (!string.IsNullOrWhiteSpace(token))
            req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
    }

    public void Dispose()
    {
        _initLock.Dispose();
        // _http dispose edilmez — HttpClientPool.SharedHandler paylaşılıyor.
    }
}

/// <summary>MCP sunucusu veya JSON-RPC protokol hatası.</summary>
public sealed class McpException : Exception
{
    public McpException(string message) : base(message) { }
}
