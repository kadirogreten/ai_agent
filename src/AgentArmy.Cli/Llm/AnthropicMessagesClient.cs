using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;

namespace AgentArmy.Cli;

/// <summary>
/// PR10: Anthropic Messages API istemcisi — ILlmClient implementasyonu.
/// Endpoint: POST /v1/messages (api.anthropic.com).
/// Gereksinimler: x-api-key header, anthropic-version: 2023-06-01, max_tokens zorunlu.
/// Tool use: type=tool_use content block (OpenAI function call'dan farklı format).
/// </summary>
public sealed class AnthropicMessagesClient : ILlmClient
{
    private readonly HttpClient _http;
    private readonly string     _model;

    // max_tokens Anthropic API'de zorunlu — atlanırsa 400.
    private const int DefaultMaxTokens = 4096;
    private const string AnthropicVersion = "2023-06-01";

    public AnthropicMessagesClient(HttpClient http, string apiKey, string model, string apiBase = "https://api.anthropic.com")
    {
        _http  = http;
        _model = model;
        _http.BaseAddress = new Uri(apiBase.TrimEnd('/') + "/");
        _http.DefaultRequestHeaders.Add("x-api-key", apiKey);
        _http.DefaultRequestHeaders.Add("anthropic-version", AnthropicVersion);
        _http.DefaultRequestHeaders.Accept.Add(new MediaTypeWithQualityHeaderValue("application/json"));
    }

    // ── CompleteAsync ─────────────────────────────────────────────────────────

    public async Task<LlmResult> CompleteAsync(
        string systemPrompt, string userPrompt, CancellationToken cancellationToken)
    {
        var payload = new
        {
            model      = _model,
            max_tokens = DefaultMaxTokens,
            system     = systemPrompt,
            messages   = new[] { new { role = "user", content = userPrompt } },
        };

        var (root, tokensIn, tokensOut) = await PostAsync(payload, cancellationToken);

        var text = ExtractText(root);
        return new LlmResult(text, _model, tokensIn, tokensOut);
    }

    // ── CompleteWithToolsAsync ────────────────────────────────────────────────

    public async Task<LlmTurn> CompleteWithToolsAsync(
        string systemPrompt,
        string userPrompt,
        IReadOnlyList<ToolDescriptor> tools,
        IReadOnlyList<ToolExchange> priorExchanges,
        CancellationToken cancellationToken)
    {
        var messages = BuildMessages(userPrompt, priorExchanges);
        var toolDefs = BuildToolDefs(tools);

        var payload = new
        {
            model      = _model,
            max_tokens = DefaultMaxTokens,
            system     = systemPrompt,
            messages,
            tools      = toolDefs,
        };

        var (root, tokensIn, tokensOut) = await PostAsync(payload, cancellationToken);

        // stop_reason: "tool_use" → araç çağrısı; "end_turn" veya "max_tokens" → metin
        var stopReason = root.TryGetProperty("stop_reason", out var sr) ? sr.GetString() : null;

        if (stopReason == "tool_use" && root.TryGetProperty("content", out var content))
        {
            var calls = new List<ToolCall>();
            foreach (var block in content.EnumerateArray())
            {
                if (!block.TryGetProperty("type", out var t) || t.GetString() != "tool_use") continue;
                var id   = block.TryGetProperty("id",   out var idProp)   ? idProp.GetString()   ?? "" : "";
                var name = block.TryGetProperty("name", out var nameProp) ? nameProp.GetString() ?? "" : "";
                var args = block.TryGetProperty("input", out var inp)
                    ? JsonSerializer.Deserialize<JsonElement>(inp.GetRawText())
                    : JsonDocument.Parse("{}").RootElement;
                calls.Add(new ToolCall(name, args, id));
            }
            if (calls.Count > 0)
                return new LlmTurn(null, calls, _model, tokensIn, tokensOut);
        }

        return new LlmTurn(ExtractText(root), Array.Empty<ToolCall>(), _model, tokensIn, tokensOut);
    }

    // ── Yardımcılar ───────────────────────────────────────────────────────────

    private static string ExtractText(JsonElement root)
    {
        if (!root.TryGetProperty("content", out var content)) return string.Empty;
        foreach (var block in content.EnumerateArray())
        {
            if (block.TryGetProperty("type", out var t) && t.GetString() == "text"
                && block.TryGetProperty("text", out var tx))
                return tx.GetString()?.Trim() ?? string.Empty;
        }
        return string.Empty;
    }

    private static object[] BuildMessages(string userPrompt, IReadOnlyList<ToolExchange> priorExchanges)
    {
        var msgs = new List<object>();
        // Önceki araç döngüsü geri dönüşümü (ToolExchange: tek Call + ToolResult)
        foreach (var ex in priorExchanges)
        {
            var call = ex.Call;
            // assistant → tool_use content block
            msgs.Add(new
            {
                role    = "assistant",
                content = new object[] { new { type = "tool_use", id = call.CallId, name = call.Slug, input = call.Args } },
            });
            // user → tool_result content block
            var resultText = ex.Result.Output is JsonElement outp
                ? (outp.ValueKind == JsonValueKind.String ? outp.GetString() : outp.GetRawText())
                : (ex.Result.Error ?? "");
            msgs.Add(new
            {
                role    = "user",
                content = new object[] { new { type = "tool_result", tool_use_id = call.CallId, content = resultText ?? "" } },
            });
        }
        // Asıl kullanıcı mesajı
        msgs.Add(new { role = "user", content = userPrompt });
        return msgs.ToArray();
    }

    private static object[] BuildToolDefs(IReadOnlyList<ToolDescriptor> tools) =>
        tools.Select(t => (object)new
        {
            name        = t.Slug,
            description = t.Description ?? t.Name,
            input_schema = new { type = "object", properties = new { }, required = Array.Empty<string>() },
        }).ToArray();

    private async Task<(JsonElement Root, int TokensIn, int TokensOut)> PostAsync(
        object payload, CancellationToken ct)
    {
        var json    = JsonSerializer.Serialize(payload);
        var content = new StringContent(json, Encoding.UTF8, "application/json");

        using var resp = await _http.PostAsync("v1/messages", content, ct);
        var body = await resp.Content.ReadAsStringAsync(ct);

        if (!resp.IsSuccessStatusCode)
            throw new InvalidOperationException(
                $"Anthropic request failed: {(int)resp.StatusCode} {resp.ReasonPhrase}\n{body[..Math.Min(400, body.Length)]}");

        using var doc = JsonDocument.Parse(body);
        var root = doc.RootElement.Clone();

        int tokensIn = 0, tokensOut = 0;
        if (root.TryGetProperty("usage", out var usage))
        {
            if (usage.TryGetProperty("input_tokens",  out var i)) tokensIn  = i.GetInt32();
            if (usage.TryGetProperty("output_tokens", out var o)) tokensOut = o.GetInt32();
        }

        return (root, tokensIn, tokensOut);
    }
}
