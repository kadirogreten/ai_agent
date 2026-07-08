using System.Net;
using System.Text;
using System.Text.Json;
using Xunit;

namespace AgentArmy.Cli.Tests;

/// <summary>
/// PR-S5: social_metrics_fetch + ads_metrics_fetch — deterministik demo, spent yazılmaz.
/// </summary>
public sealed class SocialMetricsFlowTests
{
    private static RunContext MakeCtx(SupabaseWriter? db = null) => new()
    {
        RunId    = "social-metrics-" + Guid.NewGuid().ToString("N")[..8],
        RunDir   = string.Empty,
        Contract = new TaskContract(
            Persona:         "sosyal-analist",
            Goal:            "test",
            Topic:           "test",
            Deliverables:    "test",
            Scope:           string.Empty,
            OutOfScope:      string.Empty,
            QualityCriteria: string.Empty,
            Risk:            "R1",
            ToolPermissions: "tools: social_metrics_fetch, ads_metrics_fetch",
            Deadline:        string.Empty),
        Playbook = new Playbook
        {
            Id             = "sosyal-haftalik-rapor",
            Title          = "Test",
            DefaultPersona = "sosyal-analist",
            Steps          = new List<PlaybookStep>(),
        },
        Db = db,
    };

    private static JsonElement SocialArgs(string platform = "instagram") =>
        JsonSerializer.SerializeToElement(new { platform });

    private static JsonElement AdsArgs(string campaignId) =>
        JsonSerializer.SerializeToElement(new { campaign_id = campaignId });

    [Fact]
    public async Task SocialMetrics_Deterministic_Seed()
    {
        var tool = new SocialMetricsFetchTool();
        var ctx  = MakeCtx();

        var r1 = await tool.InvokeAsync(SocialArgs("instagram"), ctx, CancellationToken.None);
        var r2 = await tool.InvokeAsync(SocialArgs("instagram"), ctx, CancellationToken.None);

        Assert.True(r1.Ok, r1.Error);
        Assert.Equal(r1.Output!.Value.GetRawText(), r2.Output!.Value.GetRawText());
    }

    [Fact]
    public async Task AdsMetrics_Deterministic_Spent()
    {
        var tool = new AdsMetricsFetchTool();
        var ctx  = MakeCtx();
        const string cid = "camp_deterministic_42";

        var r1 = await tool.InvokeAsync(AdsArgs(cid), ctx, CancellationToken.None);
        var r2 = await tool.InvokeAsync(AdsArgs(cid), ctx, CancellationToken.None);

        Assert.True(r1.Ok, r1.Error);
        Assert.Equal(
            r1.Output!.Value.GetProperty("spent").GetDecimal(),
            r2.Output!.Value.GetProperty("spent").GetDecimal());
    }

    [Fact]
    public async Task AdsMetrics_AnomalySpike_Flagged()
    {
        var tool = new AdsMetricsFetchTool();
        var ctx  = MakeCtx();

        var result = await tool.InvokeAsync(
            AdsArgs(AdsMetricsDemo.AnomalyCampaignId),
            ctx,
            CancellationToken.None);

        Assert.True(result.Ok, result.Error);
        Assert.True(result.Output!.Value.GetProperty("anomaly_spike").GetBoolean());
    }

    [Fact]
    public void AdsMetrics_AnomalyRule_Math()
    {
        var metrics = AdsMetricsDemo.Compute(AdsMetricsDemo.AnomalyCampaignId, 1000m, createdAt: null);
        Assert.Equal(metrics.Spent > metrics.DailyBudget * 1.2m, metrics.AnomalySpike);
    }

    [Fact]
    public async Task AdsMetrics_DoesNotWriteLedger()
    {
        var writeMethods = new List<string>();
        var handler = new LedgerReadOnlyHandler(writeMethods);
        using var db = new SupabaseWriter("https://fake.supabase.co", "fake-key", handler);

        Environment.SetEnvironmentVariable("RUN_OWNER_USER_ID", "00000000-0000-4000-8000-000000000001");
        try
        {
            var tool = new AdsMetricsFetchTool();
            var ctx  = MakeCtx(db);

            var result = await tool.InvokeAsync(
                AdsArgs("camp_readonly_test"),
                ctx,
                CancellationToken.None);

            Assert.True(result.Ok, result.Error);
            Assert.Empty(writeMethods);
        }
        finally
        {
            Environment.SetEnvironmentVariable("RUN_OWNER_USER_ID", null);
        }
    }

    private sealed class LedgerReadOnlyHandler(List<string> writeMethods) : HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            if (request.RequestUri!.AbsolutePath.Contains("ad_spend_ledger", StringComparison.Ordinal) &&
                request.Method != HttpMethod.Get)
            {
                writeMethods.Add(request.Method.Method);
            }

            if (request.Method == HttpMethod.Get && request.RequestUri.AbsolutePath.Contains("ad_spend_ledger"))
            {
                var body = JsonSerializer.Serialize(new[]
                {
                    new
                    {
                        daily_budget = 1000m,
                        created_at   = "2026-07-01T00:00:00Z",
                        status       = "active",
                    },
                });
                return Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK)
                {
                    Content = new StringContent(body, Encoding.UTF8, "application/json"),
                });
            }

            return Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK)
            {
                Content = new StringContent("[]", Encoding.UTF8, "application/json"),
            });
        }
    }
}
