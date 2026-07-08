using System.Globalization;
using System.Text.Json;

namespace AgentArmy.Cli;

// PR-S4: reklam kampanyası oluşturma (demo) — her zaman PAUSED + ledger kaydı.

public sealed class AdsCampaignCreateTool : ITool
{
    public string Slug => "ads_campaign_create";

    private static readonly JsonElement InputSchemaJson = Schema("""
    {
      "type": "object",
      "required": ["platform", "daily_budget", "total_budget_cap"],
      "properties": {
        "platform":         { "type": "string", "enum": ["facebook", "instagram", "x"] },
        "daily_budget":     { "type": "number", "minimum": 0 },
        "total_budget_cap": { "type": "number", "minimum": 0 },
        "currency":         { "type": "string", "default": "TRY" },
        "name":             { "type": "string" }
      }
    }
    """);

    private static readonly JsonElement OutputSchemaJson = Schema("""
    {
      "type": "object",
      "properties": {
        "campaign_id":      { "type": "string" },
        "platform":         { "type": "string" },
        "status":           { "type": "string" },
        "daily_budget":     { "type": "number" },
        "total_budget_cap": { "type": "number" },
        "currency":         { "type": "string" },
        "created_at":       { "type": "string" }
      }
    }
    """);

    public ToolDescriptor Descriptor => new()
    {
        Slug         = Slug,
        Name         = "Reklam Kampanyası Oluştur",
        Description  = "Kampanyayı platformda PAUSED durumda oluşturur ve ad_spend_ledger'a kaydeder (demo).",
        Category     = "communication",
        SideEffect   = ToolSideEffect.Write,
        Reversible   = true,
        MinRisk      = "R1",
        InputSchema  = InputSchemaJson,
        OutputSchema = OutputSchemaJson,
    };

    public async Task<ToolResult> InvokeAsync(JsonElement args, RunContext ctx, CancellationToken ct)
    {
        if (args.ValueKind != JsonValueKind.Object)
            return ToolResult.Failure(Slug, "Argümanlar bir JSON nesnesi olmalı.");

        if (!TryPlatform(args, out var platform))
            return ToolResult.Failure(Slug, "Zorunlu 'platform' (facebook|instagram|x) eksik/geçersiz.");

        if (!TryDecimal(args, "daily_budget", out var daily) || daily < 0)
            return ToolResult.Failure(Slug, "Zorunlu 'daily_budget' (>=0) eksik/geçersiz.");

        if (!TryDecimal(args, "total_budget_cap", out var total) || total < 0)
            return ToolResult.Failure(Slug, "Zorunlu 'total_budget_cap' (>=0) eksik/geçersiz.");

        var currency = args.TryGetProperty("currency", out var cEl) && cEl.ValueKind == JsonValueKind.String
            ? cEl.GetString()!.Trim().ToUpperInvariant()
            : "TRY";

        var owner = ctx.OwnerId;
        if (string.IsNullOrWhiteSpace(owner))
            return ToolResult.Failure(Slug, "RUN_OWNER_USER_ID yok — ledger kaydı açılamıyor.");

        if (ctx.Db is null)
            return ToolResult.Failure(Slug, "DB yapılandırılmamış — ad_spend_ledger yazılamıyor.");

        var campaignId = AdsLedgerHelper.BuildCampaignId(platform, daily, total, owner);

        try
        {
            await AdsLedgerHelper.TryInsertPausedAsync(
                ctx.Db, owner, campaignId, platform, daily, total, currency, ct);
        }
        catch (Exception ex)
        {
            return ToolResult.Failure(Slug, $"Ledger kaydı oluşturulamadı: {ex.Message}");
        }

        var output = JsonSerializer.SerializeToElement(new
        {
            campaign_id      = campaignId,
            platform,
            status           = "paused",
            daily_budget     = daily,
            total_budget_cap = total,
            currency,
            created_at       = "2026-07-08T12:00:00Z",
        });

        var token = JsonSerializer.Serialize(new { campaign_id = campaignId });
        return ToolResult.Success(Slug, output, compensationToken: token);
    }

    private static bool TryPlatform(JsonElement args, out string platform)
    {
        platform = string.Empty;
        if (!args.TryGetProperty("platform", out var p) || p.ValueKind != JsonValueKind.String)
            return false;
        platform = p.GetString()!.Trim().ToLowerInvariant();
        return platform is "facebook" or "instagram" or "x";
    }

    private static bool TryDecimal(JsonElement args, string name, out decimal value)
    {
        value = 0m;
        if (!args.TryGetProperty(name, out var el)) return false;
        if (el.ValueKind == JsonValueKind.Number) { value = el.GetDecimal(); return true; }
        if (el.ValueKind == JsonValueKind.String &&
            decimal.TryParse(el.GetString(), NumberStyles.Any, CultureInfo.InvariantCulture, out value))
            return true;
        return false;
    }

    private static JsonElement Schema(string json)
    {
        using var doc = JsonDocument.Parse(json);
        return doc.RootElement.Clone();
    }
}
