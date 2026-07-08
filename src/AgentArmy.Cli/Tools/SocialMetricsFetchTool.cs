using System.Text.Json;

namespace AgentArmy.Cli;

// PR-S5: organik sosyal metrikler (demo, deterministik StableHash).

public sealed class SocialMetricsFetchTool : ITool
{
    public string Slug => "social_metrics_fetch";

    private static readonly JsonElement InputSchemaJson = Schema("""
    {
      "type": "object",
      "required": ["platform"],
      "properties": {
        "platform": { "type": "string", "enum": ["facebook", "instagram", "x"] },
        "since":    { "type": "string", "description": "Opsiyonel ISO-8601 başlangıç" },
        "until":    { "type": "string", "description": "Opsiyonel ISO-8601 bitiş" }
      }
    }
    """);

    private static readonly JsonElement OutputSchemaJson = Schema("""
    {
      "type": "object",
      "properties": {
        "platform":         { "type": "string" },
        "reach":            { "type": "integer" },
        "engagement_rate":  { "type": "number" },
        "follower_delta":   { "type": "integer" },
        "impressions":      { "type": "integer" },
        "fetched_at":       { "type": "string" }
      }
    }
    """);

    public ToolDescriptor Descriptor => new()
    {
        Slug         = Slug,
        Name         = "Sosyal Metrik Çek",
        Description  = "Platform organik metriklerini döner (demo, deterministik).",
        Category     = "data",
        SideEffect   = ToolSideEffect.Read,
        Reversible   = true,
        MinRisk      = "R0",
        InputSchema  = InputSchemaJson,
        OutputSchema = OutputSchemaJson,
    };

    public Task<ToolResult> InvokeAsync(JsonElement args, RunContext ctx, CancellationToken ct)
    {
        if (args.ValueKind != JsonValueKind.Object ||
            !args.TryGetProperty("platform", out var pEl) ||
            pEl.ValueKind != JsonValueKind.String ||
            string.IsNullOrWhiteSpace(pEl.GetString()))
        {
            return Task.FromResult(ToolResult.Failure(Slug, "Zorunlu 'platform' (facebook|instagram|x) eksik."));
        }

        var platform = pEl.GetString()!.Trim().ToLowerInvariant();
        if (platform is not ("facebook" or "instagram" or "x"))
            return Task.FromResult(ToolResult.Failure(Slug, $"Desteklenmeyen platform: {platform}"));

        var seed = StableHash.Seed(platform);
        var reach = 5000 + (int)(seed % 45000);
        var impressions = reach + (int)(seed % 10000);
        var engagementRate = Math.Round(0.02m + (seed % 80) / 1000m, 4);
        var followerDelta = (int)(seed % 500) - 50;

        var output = JsonSerializer.SerializeToElement(new
        {
            platform,
            reach,
            engagement_rate = engagementRate,
            follower_delta  = followerDelta,
            impressions,
            fetched_at      = "2026-07-08T12:00:00Z",
        });

        return Task.FromResult(ToolResult.Success(Slug, output));
    }

    private static JsonElement Schema(string json)
    {
        using var doc = JsonDocument.Parse(json);
        return doc.RootElement.Clone();
    }
}
