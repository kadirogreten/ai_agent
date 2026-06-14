using System.Text.Json;

namespace AgentArmy.Cli;

/// <summary>
/// DB'den okunan MCP araç satırı.
/// Slug: tools.slug (global unique, mcp-sync tarafından {server_slug}__{tool_name} formatında üretilir).
/// MCP araç adı: tools.mcp_tool_name (MCP sunucusunun tools/list'teki adı).
/// Sözleşme alanları: DB'den okunur — MCP tanımından otomatik güven yok (tasarım §MCP.3).
/// </summary>
internal sealed record McpToolRow(
    string      Slug,
    string      Name,
    string?     Description,
    JsonElement InputSchema,
    string      SideEffect,   // none|read|write|external (tools.side_effect CHECK)
    bool        Reversible,
    string      MinRisk,      // R0-R3
    string      McpToolName   // tools.mcp_tool_name
);

/// <summary>
/// ITool adapter'ı: DB sözleşme kolonlarından Descriptor kurar; InvokeAsync → McpClient.CallToolAsync.
///
/// Faz A kuralı otomatik uygulanır:
///   - mcp-sync varsayılanları: side_effect='external', reversible=false
///   → IsAllowedInPhaseA = false → AvailableFor()'da görünmez
///   → ExecuteAsync'de Blocked + audit
///   İnsan portal'dan side_effect='read' (veya write+reversible=true) yapınca devreye girer.
///
/// enabled/disabled: ctx.ToolEnabledMap üzerinden ToolExecutor'da yönetilir (PR8 deseni).
/// Prompt injection: ToolResult sarmaı PR11 ToolResultDelimiter ile korunuyor.
/// </summary>
public sealed class McpProxyTool : ITool
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
            return ToolResult.Success(Slug, output);
        }
        catch (TaskCanceledException)
        {
            throw; // gerçek iptal → run seviyesine yükselt
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

    // ── Yardımcılar ──────────────────────────────────────────────────────────

    private static ToolDescriptor BuildDescriptor(McpToolRow row) => new()
    {
        Slug        = row.Slug,
        Name        = row.Name,
        Description = row.Description ?? $"MCP proxy → {row.McpToolName}",
        Category    = "utility",  // tools.category CHECK'e uyan tek genel seçenek
        SideEffect  = ToolSideEffects.Parse(row.SideEffect),
        Reversible  = row.Reversible,
        MinRisk     = row.MinRisk,
        InputSchema = row.InputSchema,
    };
}
