using System.Net;
using System.Text;
using System.Text.Json;
using Xunit;

namespace AgentArmy.Cli.Tests;

/// <summary>
/// PR-S4: ads_campaign_* — cap guardrail (gate öncesi) + R3 + compensation pause.
/// </summary>
public sealed class AdsCampaignFlowTests : IDisposable
{
    private const string TestOwnerId = "00000000-0000-4000-8000-000000000001";
    private readonly string? _prevOwner;

    public AdsCampaignFlowTests()
    {
        _prevOwner = Environment.GetEnvironmentVariable("RUN_OWNER_USER_ID");
        Environment.SetEnvironmentVariable("RUN_OWNER_USER_ID", TestOwnerId);
        PolicyReader.InvalidateCache();
    }

    public void Dispose()
    {
        Environment.SetEnvironmentVariable("RUN_OWNER_USER_ID", _prevOwner);
        PolicyReader.InvalidateCache();
    }

    private static RunContext MakeCtx(SupabaseWriter? db = null, string risk = "R3") => new()
    {
        RunId    = "ads-campaign-" + Guid.NewGuid().ToString("N")[..8],
        RunDir   = string.Empty,
        Contract = new TaskContract(
            Persona:         "ads-manager",
            Goal:            "test",
            Topic:           "test",
            Deliverables:    "test",
            Scope:           string.Empty,
            OutOfScope:      string.Empty,
            QualityCriteria: string.Empty,
            Risk:            risk,
            ToolPermissions: "tools: ads_campaign_create, ads_campaign_activate, ads_campaign_pause",
            Deadline:        string.Empty),
        Playbook = new Playbook
        {
            Id             = "reklam-kampanya-yayinla",
            Title          = "Test",
            DefaultPersona = "ads-manager",
            Steps          = new List<PlaybookStep>(),
        },
        Db = db,
    };

    private static JsonElement ActivateArgs(string campaignId = "camp_test_over_cap") =>
        JsonSerializer.SerializeToElement(new { campaign_id = campaignId });

    private static SupabaseWriter MakeLedgerDb(
        decimal dailyBudget = 10000m,
        decimal totalCap = 60000m,
        string status = "paused",
        string campaignId = "camp_test_over_cap")
    {
        var ledgerJson = JsonSerializer.Serialize(new[]
        {
            new
            {
                campaign_id      = campaignId,
                platform         = "facebook",
                daily_budget     = dailyBudget,
                total_budget_cap = totalCap,
                currency         = "TRY",
                status,
            },
        });

        var handler = new RoutingStubHandler(req =>
        {
            var path = req.RequestUri!.AbsolutePath;
            if (path.Contains("ad_spend_ledger", StringComparison.Ordinal))
            {
                if (req.Method == HttpMethod.Get)
                    return JsonOk(ledgerJson);
                if (req.Method == HttpMethod.Patch)
                {
                    var body = req.Content!.ReadAsStringAsync().GetAwaiter().GetResult();
                    if (body.Contains("\"status\":\"active\"", StringComparison.Ordinal))
                        ledgerJson = ledgerJson.Replace("\"paused\"", "\"active\"");
                    if (body.Contains("\"status\":\"paused\"", StringComparison.Ordinal))
                        ledgerJson = ledgerJson.Replace("\"active\"", "\"paused\"");
                    return JsonOk("[]");
                }
                if (req.Method == HttpMethod.Post)
                    return JsonOk("[]");
            }
            if (path.Contains("policy_settings", StringComparison.Ordinal))
                return JsonOk("[]");
            return JsonOk("[]");
        });

        return new SupabaseWriter("https://fake.supabase.co", "fake-key", handler);
    }

    private static HttpResponseMessage JsonOk(string body) =>
        new(HttpStatusCode.OK) { Content = new StringContent(body, Encoding.UTF8, "application/json") };

    [Fact]
    public async Task Activate_CapExceeded_GateNotCalled()
    {
        using var db = MakeLedgerDb(dailyBudget: 10000m, totalCap: 60000m);
        var gate = new FakeRiskGate(approve: true);
        var tool = new AdsCampaignActivateTool();
        var exec = new ToolExecutor(
            new ITool[] { tool },
            gate:   gate,
            budget: new FakeBudgetChecker(allowed: true));
        var ctx = MakeCtx(db, "R3");

        var result = await exec.ExecuteAsync(
            tool.Slug,
            ActivateArgs(),
            AgentsCatalog.All["Operator"],
            ctx,
            CancellationToken.None);

        Assert.False(result.Ok, result.Error);
        Assert.False(gate.WasCalled, "Cap aşımında RiskGate çağrılmamalı.");
        Assert.Contains("cap", result.Error!, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task Activate_R3_Approved_Succeeds()
    {
        using var db = MakeLedgerDb(dailyBudget: 1000m, totalCap: 5000m);
        var gate = new FakeRiskGate(approve: true, queueId: "queue-ads");
        var tool = new AdsCampaignActivateTool();
        var exec = new ToolExecutor(
            new ITool[] { tool },
            gate:   gate,
            budget: new FakeBudgetChecker(allowed: true));
        var ctx = MakeCtx(db, "R3");

        var result = await exec.ExecuteAsync(
            tool.Slug,
            ActivateArgs(),
            AgentsCatalog.All["Operator"],
            ctx,
            CancellationToken.None);

        Assert.True(result.Ok, result.Error);
        Assert.True(gate.WasCalled);
        Assert.Equal("active", result.Output!.Value.GetProperty("status").GetString());
    }

    [Fact]
    public async Task Activate_R3_Rejected_Blocked()
    {
        using var db = MakeLedgerDb(dailyBudget: 1000m, totalCap: 5000m);
        var gate = new FakeRiskGate(approve: false, reason: "pending");
        var tool = new AdsCampaignActivateTool();
        var exec = new ToolExecutor(
            new ITool[] { tool },
            gate:   gate,
            budget: new FakeBudgetChecker(allowed: true));
        var ctx = MakeCtx(db, "R3");

        var result = await exec.ExecuteAsync(
            tool.Slug,
            ActivateArgs(),
            AgentsCatalog.All["Operator"],
            ctx,
            CancellationToken.None);

        Assert.False(result.Ok);
        Assert.Contains("Onay alınamadı", result.Error);
        Assert.True(gate.WasCalled);
    }

    [Fact]
    public async Task Compensation_AfterActivate_PausesCampaign()
    {
        var campaignId = "camp_comp_test";
        using var db = MakeLedgerDb(dailyBudget: 1000m, totalCap: 5000m, status: "active", campaignId);
        var activate = new AdsCampaignActivateTool();
        var token = JsonSerializer.Serialize(new { campaign_id = campaignId });

        var comp = await activate.CompensateAsync(token, db, TestOwnerId, CancellationToken.None);

        Assert.True(comp.Ok, comp.Message);

        var ledger = await AdsLedgerHelper.TryLoadAsync(db, TestOwnerId, campaignId, CancellationToken.None);
        Assert.NotNull(ledger);
        Assert.Equal("paused", ledger!.Status);
    }

    [Fact]
    public void ActivateTools_AllowedInPhaseA()
    {
        Assert.True(new AdsCampaignCreateTool().Descriptor.IsAllowedInPhaseA);
        Assert.True(new AdsCampaignActivateTool().Descriptor.IsAllowedInPhaseA);
        Assert.True(new AdsCampaignPauseTool().Descriptor.IsAllowedInPhaseA);
        Assert.Equal("ads_campaign_pause", new AdsCampaignActivateTool().Descriptor.Compensation);
    }

    [Fact]
    public void AdsBudgetGuard_ExceedsCap_DetectsOverLimit()
    {
        Assert.True(AdsBudgetGuard.ExceedsCap(6000m, 40000m, 5000m, 50000m));
        Assert.False(AdsBudgetGuard.ExceedsCap(4000m, 40000m, 5000m, 50000m));
    }

    /// <summary>URL yoluna göre stub yanıt döner.</summary>
    private sealed class RoutingStubHandler(Func<HttpRequestMessage, HttpResponseMessage> route) : HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken) =>
            Task.FromResult(route(request));
    }
}
