using System.Text.Json;

namespace AgentArmy.Cli;

/// <summary>DB'den okunan MCP araç satırı.</summary>
internal sealed record McpToolRow(
    string      Slug,
    string      Name,
    string?     Description,
    JsonElement InputSchema,
    string      SideEffect,
    bool        Reversible,
    string      MinRisk,
    string      McpToolName,
    string?     Compensation = null
);

/// <summary>
/// ITool adapter'ı: DB sözleşme kolonlarından Descriptor kurar; InvokeAsync → McpClient.CallToolAsync.
/// PR-S7b: compensation MCP aracı + token çıkarımı (post_id / reply_id).
/// </summary>
public sealed class McpProxyTool : ITool, ICompensable
{
    private readonly McpToolRow _row;
    private readonly IMcpClient _client;

    internal McpProxyTool(McpToolRow row, IMcpClient client)
    {
        _row       = row;
        _client    = client;
        Descriptor = BuildDescriptor(row);
    }

    public string         Slug       => _row.Slug;
    public ToolDescriptor Descriptor { get; }

    public async Task<ToolResult> InvokeAsync(JsonElement args, RunContext ctx, CancellationToken ct)
    {
        try
        {
            var output = await _client.CallToolAsync(_row.McpToolName, args, ct);
            var token  = TryExtractCompensationToken(output);
            return ToolResult.Success(Slug, output, compensationToken: token);
        }
        catch (TaskCanceledException)
        {
            throw;
        }
        catch (McpException ex)
        {
            return ToolResult.Failure(Slug, $"MCP araç hatası ({_row.McpToolName}): {ex.Message}");
        }
        catch (Exception ex)
        {
            return ToolResult.Failure(Slug, $"MCP bağlantı hatası: {ex.Message}");
        }
    }

    public async Task<CompensationResult> CompensateAsync(
        string token, SupabaseWriter? db, string? ownerId, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(_row.Compensation))
            return CompensationResult.Failure($"'{Slug}' için compensation tanımlı değil.");

        if (string.IsNullOrWhiteSpace(token))
            return CompensationResult.Failure("Boş compensation_token.");

        try
        {
            var argName = _row.Compensation switch
            {
                "post_delete"  => "post_id",
                "reply_delete" => "reply_id",
                _              => "id",
            };
            var compArgs = JsonSerializer.SerializeToElement(new Dictionary<string, string>
            {
                [argName] = token,
            });
            await _client.CallToolAsync(_row.Compensation, compArgs, ct);
            return CompensationResult.Success($"{_row.Compensation} tamamlandı.");
        }
        catch (Exception ex)
        {
            return CompensationResult.Failure($"Compensation başarısız ({_row.Compensation}): {ex.Message}");
        }
    }

    private string? TryExtractCompensationToken(JsonElement output)
    {
        if (string.IsNullOrWhiteSpace(_row.Compensation)) return null;

        var field = _row.Compensation switch
        {
            "post_delete"  => "post_id",
            "reply_delete" => "reply_id",
            _              => null,
        };
        if (field is null) return null;

        if (TryGetString(output, field, out var direct)) return direct;

        // MCP content[] text JSON sarmalayıcısı
        if (output.ValueKind == JsonValueKind.Array)
        {
            foreach (var item in output.EnumerateArray())
            {
                if (item.TryGetProperty("text", out var textEl) && textEl.ValueKind == JsonValueKind.String)
                {
                    try
                    {
                        using var doc = JsonDocument.Parse(textEl.GetString() ?? "{}");
                        if (TryGetString(doc.RootElement, field, out var nested)) return nested;
                    }
                    catch { /* ignore parse */ }
                }
            }
        }

        return null;
    }

    private static bool TryGetString(JsonElement el, string prop, out string? value)
    {
        value = null;
        if (el.ValueKind == JsonValueKind.Object &&
            el.TryGetProperty(prop, out var p) &&
            p.ValueKind == JsonValueKind.String)
        {
            value = p.GetString();
            return !string.IsNullOrWhiteSpace(value);
        }
        return false;
    }

    private static ToolDescriptor BuildDescriptor(McpToolRow row) => new()
    {
        Slug        = row.Slug,
        Name        = row.Name,
        Description = row.Description ?? $"MCP proxy → {row.McpToolName}",
        Category    = "utility",
        SideEffect  = ToolSideEffects.Parse(row.SideEffect),
        Reversible  = row.Reversible,
        MinRisk     = row.MinRisk,
        InputSchema = row.InputSchema,
    };
}
