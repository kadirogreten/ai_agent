namespace AgentArmy.Cli;

// PR-S5: deterministik reklam metrikleri — demo_spent hesaplanır, ledger.spent yazılmaz (PR-S7).

internal sealed record AdsMetricsResult(
    decimal Spent,
    decimal DailyBudget,
    long Impressions,
    long Clicks,
    decimal Cpc,
    decimal Cpm,
    decimal Roas,
    bool AnomalySpike,
    int AgeDays,
    decimal SpendRatio);

internal static class AdsMetricsDemo
{
    /// <summary>StableHash ile age×ratio &gt; 1.2 garanti (daily_budget ölçeklenmez).</summary>
    internal const string AnomalyCampaignId = "camp_spike_3";

    internal static AdsMetricsResult Compute(string campaignId, decimal dailyBudget, DateTimeOffset? createdAt)
    {
        var seed = StableHash.Seed(campaignId);

        var ageDays = createdAt.HasValue
            ? Math.Max(1, (int)(DateTimeOffset.UtcNow - createdAt.Value).TotalDays)
            : 1 + (int)(seed % 5);

        var spendRatio = 0.10m + (seed % 20) / 100m;
        var spent      = Math.Round(ageDays * dailyBudget * spendRatio, 2);
        var anomaly    = spent > dailyBudget * 1.2m;

        var impressions = 1000L + (long)(seed % 9000);
        var clicks      = Math.Max(1L, impressions / (20 + (long)(seed % 30)));
        var cpc         = clicks > 0 ? Math.Round(spent / clicks, 2) : 0m;
        var cpm         = impressions > 0 ? Math.Round(spent / impressions * 1000m, 2) : 0m;
        var roas        = spent > 0 ? Math.Round(1.5m + (seed % 100) / 100m, 2) : 0m;

        return new AdsMetricsResult(spent, dailyBudget, impressions, clicks, cpc, cpm, roas, anomaly, ageDays, spendRatio);
    }

    internal static decimal FallbackDailyBudget(string campaignId) =>
        1000m + (StableHash.Seed(campaignId) % 4000);
}
