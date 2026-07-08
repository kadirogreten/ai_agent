namespace AgentArmy.Cli;

/// <summary>PR-S7b: Meta Graph + credential yardımcıları (demo fallback).</summary>
public static class MetaGraphHelper
{
    public static bool IsDemoMode()
        => string.Equals(
            Environment.GetEnvironmentVariable("SOCIAL_API_MODE"),
            "demo",
            StringComparison.OrdinalIgnoreCase);

    public static async Task<string?> ResolveTokenAsync(
        SupabaseWriter? db, string? ownerId, CancellationToken ct)
    {
        if (db is not null && !string.IsNullOrWhiteSpace(ownerId))
        {
            var resolver = new CredentialResolver(db);
            var token = await resolver.ResolveBearerAsync(ownerId, "meta", "META_ACCESS_TOKEN", ct);
            if (!string.IsNullOrWhiteSpace(token)) return token;
        }
        return Environment.GetEnvironmentVariable("META_ACCESS_TOKEN");
    }

    public static async Task<decimal?> TryFetchCampaignSpentAsync(
        string accessToken, string campaignId, CancellationToken ct)
    {
        // Demo/stub campaign id'leri için Graph çağrısı yapma
        if (campaignId.StartsWith("camp_", StringComparison.OrdinalIgnoreCase))
            return null;

        try
        {
            using var http = new HttpClient { Timeout = TimeSpan.FromSeconds(30) };
            var url =
                $"https://graph.facebook.com/v21.0/{Uri.EscapeDataString(campaignId)}/insights" +
                "?fields=spend&date_preset=maximum" +
                $"&access_token={Uri.EscapeDataString(accessToken)}";

            using var resp = await http.GetAsync(url, ct);
            var body = await resp.Content.ReadAsStringAsync(ct);
            if (!resp.IsSuccessStatusCode) return null;

            using var doc = System.Text.Json.JsonDocument.Parse(body);
            var data = doc.RootElement.GetProperty("data");
            if (data.GetArrayLength() == 0) return null;

            var spendStr = data[0].TryGetProperty("spend", out var s) ? s.GetString() : null;
            return decimal.TryParse(spendStr, System.Globalization.NumberStyles.Any,
                System.Globalization.CultureInfo.InvariantCulture, out var spent)
                ? spent : null;
        }
        catch
        {
            return null;
        }
    }
}
