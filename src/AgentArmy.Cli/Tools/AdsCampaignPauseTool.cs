using System.Text.Json;

namespace AgentArmy.Cli;

// PR-S4: kampanya duraklatma (demo) — compensation aracı + manuel pause.

public sealed class AdsCampaignPauseTool : ITool
{
    public string Slug => "ads_campaign_pause";

    private static readonly JsonElement InputSchemaJson = Schema("""
    {
      "type": "object",
      "required": ["campaign_id"],
      "properties": {
        "campaign_id": { "type": "string" }
      }
    }
    """);

    private static readonly JsonElement OutputSchemaJson = Schema("""
    {
      "type": "object",
      "properties": {
        "campaign_id": { "type": "string" },
        "status":      { "type": "string" },
        "paused_at":   { "type": "string" }
      }
    }
    """);

    public ToolDescriptor Descriptor => new()
    {
        Slug         = Slug,
        Name         = "Reklam Kampanyası Duraklat",
        Description  = "Aktif kampanyayı duraklatır; ad_spend_ledger status=paused (demo).",
        Category     = "communication",
        SideEffect   = ToolSideEffect.Write,
        Reversible   = true,
        MinRisk      = "R1",
        InputSchema  = InputSchemaJson,
        OutputSchema = OutputSchemaJson,
    };

    public async Task<ToolResult> InvokeAsync(JsonElement args, RunContext ctx, CancellationToken ct)
    {
        if (!TryCampaignId(args, out var campaignId))
            return ToolResult.Failure(Slug, "Zorunlu 'campaign_id' eksik.");

        var owner = ctx.OwnerId;
        if (string.IsNullOrWhiteSpace(owner))
            return ToolResult.Failure(Slug, "RUN_OWNER_USER_ID yok — pause yapılamıyor.");

        if (ctx.Db is null)
            return ToolResult.Failure(Slug, "DB yapılandırılmamış — ledger güncellenemiyor.");

        var ledger = await AdsLedgerHelper.TryLoadAsync(ctx.Db, owner, campaignId, ct);
        if (ledger is null)
            return ToolResult.Failure(Slug, $"Kampanya bulunamadı: {campaignId}");

        try
        {
            await AdsLedgerHelper.TryUpdateStatusAsync(ctx.Db, owner, campaignId, "paused", ct);
        }
        catch (Exception ex)
        {
            return ToolResult.Failure(Slug, $"Duraklatma başarısız: {ex.Message}");
        }

        var output = JsonSerializer.SerializeToElement(new
        {
            campaign_id = campaignId,
            status      = "paused",
            paused_at   = "2026-07-08T12:00:00Z",
        });

        return ToolResult.Success(Slug, output);
    }

    private static bool TryCampaignId(JsonElement args, out string campaignId)
    {
        campaignId = string.Empty;
        if (args.ValueKind != JsonValueKind.Object) return false;
        if (!args.TryGetProperty("campaign_id", out var el) || el.ValueKind != JsonValueKind.String)
            return false;
        campaignId = el.GetString()!.Trim();
        return campaignId.Length > 0;
    }

    private static JsonElement Schema(string json)
    {
        using var doc = JsonDocument.Parse(json);
        return doc.RootElement.Clone();
    }
}
