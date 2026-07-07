using System.Text.Json;
using Xunit;

namespace AgentArmy.Cli.Tests;

/// <summary>
/// PR-S3: social_inbox_fetch + social_reply_send — deterministik demo + R2 RiskGate testleri.
/// </summary>
public sealed class SocialInboxFlowTests
{
    private static RunContext MakeCtx(string risk = "R2", string tools = "tools: social_inbox_fetch, social_reply_send") => new()
    {
        RunId    = "social-inbox-" + Guid.NewGuid().ToString("N")[..8],
        RunDir   = string.Empty,
        Contract = new TaskContract(
            Persona:         "community-manager",
            Goal:            "test",
            Topic:           "test",
            Deliverables:    "test",
            Scope:           string.Empty,
            OutOfScope:      string.Empty,
            QualityCriteria: string.Empty,
            Risk:            risk,
            ToolPermissions: tools,
            Deadline:        string.Empty),
        Playbook = new Playbook
        {
            Id             = "sosyal-etkilesim-yanit",
            Title          = "Test",
            DefaultPersona = "community-manager",
            Steps          = new List<PlaybookStep>(),
        },
        Db = null,
    };

    private static JsonElement InboxArgs(string platform = "instagram") =>
        JsonSerializer.SerializeToElement(new { platform });

    private static JsonElement ReplyArgs(string itemId = "ig-cmt-001", string platform = "instagram") =>
        JsonSerializer.SerializeToElement(new
        {
            item_id  = itemId,
            text     = "Siparişiniz 1-2 iş günü içinde kargoya verilir.",
            platform,
        });

    [Fact]
    public async Task InboxFetch_Deterministic_Seed()
    {
        var exec = new ToolExecutor(new ITool[] { new SocialInboxFetchTool() });
        var ctx  = MakeCtx("R0");

        var r1 = await exec.ExecuteAsync(
            "social_inbox_fetch",
            InboxArgs("instagram"),
            AgentsCatalog.All["Operator"],
            ctx,
            CancellationToken.None);

        var r2 = await exec.ExecuteAsync(
            "social_inbox_fetch",
            InboxArgs("instagram"),
            AgentsCatalog.All["Operator"],
            ctx,
            CancellationToken.None);

        Assert.True(r1.Ok, r1.Error);
        Assert.True(r2.Ok, r2.Error);
        Assert.Equal(r1.Output!.Value.GetRawText(), r2.Output!.Value.GetRawText());

        var items = r1.Output!.Value.GetProperty("items");
        Assert.Equal(5, items.GetArrayLength());

        var ids = items.EnumerateArray()
            .Select(i => i.GetProperty("item_id").GetString())
            .OrderBy(x => x)
            .ToList();
        Assert.Equal(
            new[] { "ig-cmt-001", "ig-cmt-004", "ig-dm-002", "ig-dm-005", "ig-mnt-003" },
            ids);
    }

    [Fact]
    public async Task Reply_R2_Approved_Succeeds()
    {
        var gate = new FakeRiskGate(approve: true, queueId: "queue-inbox");
        var exec = new ToolExecutor(
            new ITool[] { new SocialReplySendTool() },
            gate:   gate,
            budget: new FakeBudgetChecker(allowed: true));
        var ctx = MakeCtx("R2");

        var result = await exec.ExecuteAsync(
            "social_reply_send",
            ReplyArgs(),
            AgentsCatalog.All["Operator"],
            ctx,
            CancellationToken.None);

        Assert.True(result.Ok, result.Error);
        Assert.True(gate.WasCalled);
        Assert.Contains("reply_id", result.Output!.Value.GetRawText(), StringComparison.OrdinalIgnoreCase);
        Assert.Equal(
            SocialReplySendTool.DeterministicReplyId("ig-cmt-001", "instagram"),
            result.Output!.Value.GetProperty("reply_id").GetString());
    }

    [Fact]
    public async Task Reply_R2_Rejected_NoInvocation()
    {
        var gate = new FakeRiskGate(approve: false, reason: "pending");
        var exec = new ToolExecutor(
            new ITool[] { new SocialReplySendTool() },
            gate:   gate,
            budget: new FakeBudgetChecker(allowed: true));
        var ctx = MakeCtx("R2");

        var result = await exec.ExecuteAsync(
            "social_reply_send",
            ReplyArgs(),
            AgentsCatalog.All["Operator"],
            ctx,
            CancellationToken.None);

        Assert.False(result.Ok);
        Assert.Contains("Onay alınamadı", result.Error);
        Assert.True(gate.WasCalled);
    }

    [Fact]
    public async Task InboxSample_ContainsEscalationTag()
    {
        var tool = new SocialInboxFetchTool();
        var result = await tool.InvokeAsync(
            InboxArgs("facebook"),
            MakeCtx("R0"),
            CancellationToken.None);

        Assert.True(result.Ok, result.Error);

        var items = result.Output!.Value.GetProperty("items");
        var triages = items.EnumerateArray()
            .Select(i => i.GetProperty("triage").GetString())
            .ToList();

        Assert.Contains("eskale", triages);
        Assert.Contains("yanıtla", triages);
        Assert.Contains("yoksay", triages);
    }
}
