namespace AgentArmy.Cli;

// PR-S4: reklam bütçe cap guardrail — policy_settings + ledger karşılaştırması.
// Tek kaynak; LLM argümanına güvenilmez.

internal static class AdsBudgetGuard
{
    internal const decimal DefaultMaxDaily = 5000m;
    internal const decimal DefaultMaxTotal = 50000m;

    internal static bool ExceedsCap(decimal daily, decimal total, decimal maxDaily, decimal maxTotal) =>
        daily > maxDaily || total > maxTotal;

    internal static async Task<(decimal MaxDaily, decimal MaxTotal)> LoadPolicyCapsAsync(
        SupabaseWriter? db, string? ownerId, CancellationToken ct)
    {
        var maxDaily = await PolicyReader.GetAsync(db, ownerId, "ads.max_daily_budget", DefaultMaxDaily, ct);
        var maxTotal = await PolicyReader.GetAsync(db, ownerId, "ads.max_total_budget", DefaultMaxTotal, ct);
        return (maxDaily, maxTotal);
    }

    internal static string CapExceededMessage(decimal daily, decimal total, decimal maxDaily, decimal maxTotal) =>
        $"Reklam bütçe cap aşıldı: günlük {daily} > {maxDaily} veya toplam {total} > {maxTotal}. " +
        "Aktivasyon reddedildi (policy_settings).";
}
