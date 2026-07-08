using System.Globalization;
using System.Text.Json;

namespace AgentArmy.Cli;

// PR-S5: reklam metrikleri (demo) — demo_spent hesaplanır; ledger.spent GÜNCELLENMEZ (PR-S7).

public sealed class AdsMetricsFetchTool : ITool
{
    public string Slug => "ads_metrics_fetch";

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
        "campaign_id":   { "type": "string" },
        "spent":         { "type": "number" },
        "daily_budget":  { "type": "number" },
        "impressions":   { "type": "integer" },
        "clicks":        { "type": "integer" },
        "cpc":           { "type": "number" },
        "cpm":           { "type": "number" },
        "roas":          { "type": "number" },
        "anomaly_spike": { "type": "boolean" },
        "fetched_at":    { "type": "string" }
      }
    }
    """);

    public ToolDescriptor Descriptor => new()
    {
        Slug         = Slug,
        Name         = "Reklam Metrik Çek",
        Description  = "Kampanya reklam metriklerini döner (demo spent hesaplanır; ledger.spent güncellenmez).",
        Category     = "data",
        SideEffect   = ToolSideEffect.Read,
        Reversible   = true,
        MinRisk      = "R0",
        InputSchema  = InputSchemaJson,
        OutputSchema = OutputSchemaJson,
    };

    public async Task<ToolResult> InvokeAsync(JsonElement args, RunContext ctx, CancellationToken ct)
    {
        if (args.ValueKind != JsonValueKind.Object ||
            !args.TryGetProperty("campaign_id", out var idEl) ||
            idEl.ValueKind != JsonValueKind.String ||
            string.IsNullOrWhiteSpace(idEl.GetString()))
        {
            return ToolResult.Failure(Slug, "Zorunlu 'campaign_id' eksik.");
        }

        var campaignId = idEl.GetString()!.Trim();
        decimal dailyBudget;
        DateTimeOffset? createdAt = null;

        var owner = ctx.OwnerId;
        if (ctx.Db is not null && !string.IsNullOrWhiteSpace(owner))
        {
            var ledger = await AdsLedgerHelper.TryLoadMetricsContextAsync(ctx.Db, owner, campaignId, ct);
            if (ledger is not null)
            {
                dailyBudget = ledger.DailyBudget;
                createdAt   = ledger.CreatedAt;
            }
            else
            {
                dailyBudget = AdsMetricsDemo.FallbackDailyBudget(campaignId);
            }
        }
        else
        {
            dailyBudget = AdsMetricsDemo.FallbackDailyBudget(campaignId);
        }

        var metrics = AdsMetricsDemo.Compute(campaignId, dailyBudget, createdAt);

        var output = JsonSerializer.SerializeToElement(new
        {
            campaign_id   = campaignId,
            spent         = metrics.Spent,
            daily_budget  = metrics.DailyBudget,
            impressions   = metrics.Impressions,
            clicks        = metrics.Clicks,
            cpc           = metrics.Cpc,
            cpm           = metrics.Cpm,
            roas          = metrics.Roas,
            anomaly_spike = metrics.AnomalySpike,
            fetched_at    = "2026-07-08T12:00:00Z",
        });

        return ToolResult.Success(Slug, output);
    }

    private static JsonElement Schema(string json)
    {
        using var doc = JsonDocument.Parse(json);
        return doc.RootElement.Clone();
    }
}
