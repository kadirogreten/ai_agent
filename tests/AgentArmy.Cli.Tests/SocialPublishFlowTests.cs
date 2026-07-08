using System.Text.Json;
using Xunit;

namespace AgentArmy.Cli.Tests;

/// <summary>
/// PR-S2: meta-social__post_publish — R2 RiskGate + MCP proxy entegrasyon testleri.
/// </summary>
public sealed class SocialPublishFlowTests
{
    private static RunContext MakeCtx(string risk = "R2") => new()
    {
        RunId    = "social-publish-" + Guid.NewGuid().ToString("N")[..8],
        RunDir   = string.Empty,
        Contract = new TaskContract(
            Persona:         "copywriter",
            Goal:            "test",
            Topic:           "test",
            Deliverables:    "test",
            Scope:           string.Empty,
            OutOfScope:      string.Empty,
            QualityCriteria: string.Empty,
            Risk:            risk,
            ToolPermissions: "tools: meta-social__post_publish",
            Deadline:        string.Empty),
        Playbook = new Playbook
        {
            Id             = "sosyal-post-uret",
            Title          = "Test",
            DefaultPersona = "copywriter",
            Steps          = new List<PlaybookStep>(),
        },
        Db = null,
    };

    private static McpProxyTool MakePublishTool(FakeMcpClient client, string sideEffect = "write", bool reversible = true)
    {
        var row = new McpToolRow(
            Slug:        "meta-social__post_publish",
            Name:        "Meta Post Yayınla",
            Description: "Mock MCP post_publish",
            InputSchema: JsonSerializer.SerializeToElement(new
            {
                type = "object",
                required = new[] { "platform", "text" },
                properties = new
                {
                    platform = new { type = "string" },
                    text     = new { type = "string" },
                },
            }),
            SideEffect:  sideEffect,
            Reversible:  reversible,
            MinRisk:     "R2",
            McpToolName: "post_publish",
            Compensation: "post_delete"
        );
        return new McpProxyTool(row, client);
    }

    private static JsonElement PublishArgs()
    {
        return JsonSerializer.SerializeToElement(new
        {
            platform = "facebook",
            text     = "Onaylı demo post metni",
        });
    }

    [Fact]
    public async Task Publish_R2_Approved_InvokesMcp()
    {
        var fakeClient = new FakeMcpClient(
            callResult: JsonSerializer.SerializeToElement(new
            {
                post_id = "meta_demo_123",
                url     = "https://facebook.com/demo/posts/123",
            }));
        var tool = MakePublishTool(fakeClient);
        var gate = new FakeRiskGate(approve: true, queueId: "queue-demo");
        var exec = new ToolExecutor(
            new ITool[] { tool },
            gate:   gate,
            budget: new FakeBudgetChecker(allowed: true));
        var ctx  = MakeCtx("R2");

        var result = await exec.ExecuteAsync(
            tool.Slug,
            PublishArgs(),
            AgentsCatalog.All["Operator"],
            ctx,
            CancellationToken.None);

        Assert.True(result.Ok, result.Error);
        Assert.True(gate.WasCalled);
        Assert.Equal(1, fakeClient.InvokeCallCount);
        Assert.Equal("post_publish", fakeClient.LastCalledTool);
        Assert.Contains("meta_demo_123", result.Output!.Value.GetRawText(), StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task Publish_R2_Rejected_NoInvocation()
    {
        var fakeClient = new FakeMcpClient();
        var tool = MakePublishTool(fakeClient);
        var gate = new FakeRiskGate(approve: false, reason: "pending");
        var exec = new ToolExecutor(
            new ITool[] { tool },
            gate:   gate,
            budget: new FakeBudgetChecker(allowed: true));
        var ctx  = MakeCtx("R2");

        var result = await exec.ExecuteAsync(
            tool.Slug,
            PublishArgs(),
            AgentsCatalog.All["Operator"],
            ctx,
            CancellationToken.None);

        Assert.False(result.Ok);
        Assert.Contains("Onay alınamadı", result.Error);
        Assert.True(gate.WasCalled);
        Assert.Equal(0, fakeClient.InvokeCallCount);
    }

    [Fact]
    public void Publish_NotAllowedInPhaseA_WhenMisconfigured()
    {
        var tool = MakePublishTool(new FakeMcpClient(), sideEffect: "external", reversible: false);
        var exec = new ToolExecutor(new ITool[] { tool });
        var ctx  = MakeCtx("R2");

        var available = exec.AvailableFor(AgentsCatalog.All["Operator"], ctx.Contract);

        Assert.DoesNotContain(available, d => d.Slug == "meta-social__post_publish");
        Assert.False(tool.Descriptor.IsAllowedInPhaseA);
    }
}
