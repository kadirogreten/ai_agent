using System.Globalization;
using System.Text.Json;

namespace AgentArmy.Cli;

// PR-S4: ad_spend_ledger okuma/yazma — create, activate, pause ortak.

internal sealed record AdsLedgerRow(
    string CampaignId,
    string Platform,
    decimal DailyBudget,
    decimal TotalBudgetCap,
    string Currency,
    string Status);

internal sealed record AdsLedgerMetricsContext(
    decimal DailyBudget,
    DateTimeOffset? CreatedAt,
    string Status);

internal static class AdsLedgerHelper
{
    internal static async Task<AdsLedgerRow?> TryLoadAsync(
        SupabaseWriter db, string ownerId, string campaignId, CancellationToken ct)
    {
        var filter =
            $"campaign_id=eq.{Uri.EscapeDataString(campaignId)}" +
            $"&owner_user_id=eq.{Uri.EscapeDataString(ownerId)}" +
            "&select=campaign_id,platform,daily_budget,total_budget_cap,currency,status&limit=1";

        var result = await db.SelectAsync("ad_spend_ledger", filter, ct);
        if (result.ValueKind != JsonValueKind.Array || result.GetArrayLength() == 0)
            return null;

        var row = result[0];
        if (row.ValueKind != JsonValueKind.Object) return null;

        return new AdsLedgerRow(
            CampaignId:      row.GetProperty("campaign_id").GetString()!,
            Platform:        row.GetProperty("platform").GetString()!,
            DailyBudget:     ParseDecimal(row.GetProperty("daily_budget")),
            TotalBudgetCap:  ParseDecimal(row.GetProperty("total_budget_cap")),
            Currency:        row.TryGetProperty("currency", out var c) ? c.GetString() ?? "TRY" : "TRY",
            Status:          row.GetProperty("status").GetString() ?? "paused");
    }

    internal static async Task<AdsLedgerMetricsContext?> TryLoadMetricsContextAsync(
        SupabaseWriter db, string ownerId, string campaignId, CancellationToken ct)
    {
        var filter =
            $"campaign_id=eq.{Uri.EscapeDataString(campaignId)}" +
            $"&owner_user_id=eq.{Uri.EscapeDataString(ownerId)}" +
            "&select=daily_budget,created_at,status&limit=1";

        var result = await db.SelectAsync("ad_spend_ledger", filter, ct);
        if (result.ValueKind != JsonValueKind.Array || result.GetArrayLength() == 0)
            return null;

        var row = result[0];
        if (row.ValueKind != JsonValueKind.Object) return null;

        DateTimeOffset? createdAt = null;
        if (row.TryGetProperty("created_at", out var ca) && ca.ValueKind == JsonValueKind.String &&
            DateTimeOffset.TryParse(ca.GetString(), CultureInfo.InvariantCulture, DateTimeStyles.RoundtripKind, out var parsed))
        {
            createdAt = parsed;
        }

        return new AdsLedgerMetricsContext(
            DailyBudget: ParseDecimal(row.GetProperty("daily_budget")),
            CreatedAt:   createdAt,
            Status:      row.TryGetProperty("status", out var s) ? s.GetString() ?? "paused" : "paused");
    }

    internal static async Task<bool> TryInsertPausedAsync(
        SupabaseWriter db, string ownerId, string campaignId, string platform,
        decimal dailyBudget, decimal totalBudgetCap, string currency, CancellationToken ct)
    {
        await db.InsertAsync("ad_spend_ledger", new
        {
            campaign_id      = campaignId,
            owner_user_id    = ownerId,
            platform,
            daily_budget     = dailyBudget,
            total_budget_cap = totalBudgetCap,
            spent            = 0m,
            currency,
            status           = "paused",
        }, ct);
        return true;
    }

    internal static async Task<bool> TryUpdateStatusAsync(
        SupabaseWriter db, string ownerId, string campaignId, string status, CancellationToken ct)
    {
        var filter =
            $"campaign_id=eq.{Uri.EscapeDataString(campaignId)}" +
            $"&owner_user_id=eq.{Uri.EscapeDataString(ownerId)}";
        await db.PatchAsync("ad_spend_ledger", filter, new { status }, ct);
        return true;
    }

    internal static string BuildCampaignId(string platform, decimal daily, decimal total, string ownerId)
    {
        var seed = $"{platform}:{daily}:{total}:{ownerId}";
        var hash = Math.Abs(seed.GetHashCode()).ToString("D8", CultureInfo.InvariantCulture)[..8];
        return $"camp_{platform}_{hash}";
    }

    private static decimal ParseDecimal(JsonElement el)
    {
        return el.ValueKind switch
        {
            JsonValueKind.Number => el.GetDecimal(),
            JsonValueKind.String   => decimal.TryParse(el.GetString(), NumberStyles.Any, CultureInfo.InvariantCulture, out var d) ? d : 0m,
            _                      => 0m,
        };
    }
}
