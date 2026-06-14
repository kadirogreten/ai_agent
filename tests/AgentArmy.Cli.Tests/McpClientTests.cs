using System.Text.Json;
using Xunit;

namespace AgentArmy.Cli.Tests;

// ── IMcpClient stub ───────────────────────────────────────────────────────────

/// <summary>Deterministik IMcpClient test çifti.</summary>
internal sealed class FakeMcpClient : IMcpClient
{
    private readonly IReadOnlyList<McpToolDef> _tools;
    private readonly JsonElement               _callResult;
    private readonly string?                   _callError;

    public int     ListCallCount   { get; private set; }
    public int     InvokeCallCount { get; private set; }
    public string? LastCalledTool  { get; private set; }

    public FakeMcpClient(
        IReadOnlyList<McpToolDef>? tools       = null,
        JsonElement?               callResult   = null,
        string?                    callError    = null)
    {
        _tools      = tools      ?? Array.Empty<McpToolDef>();
        _callResult = callResult ?? JsonSerializer.SerializeToElement(new { ok = true });
        _callError  = callError;
    }

    public Task<IReadOnlyList<McpToolDef>> ListToolsAsync(CancellationToken ct)
    {
        ListCallCount++;
        return Task.FromResult(_tools);
    }

    public Task<JsonElement> CallToolAsync(string toolName, JsonElement args, CancellationToken ct)
    {
        InvokeCallCount++;
        LastCalledTool = toolName;
        if (_callError is not null) throw new McpException(_callError);
        return Task.FromResult(_callResult);
    }
}

// ── Test yardımcıları (McpClientTests dosyasına özgü) ────────────────────────

file static class McpTestHelpers
{
    public static RunContext MakeCtx(IReadOnlyDictionary<string, bool>? enabledMap = null) => new()
    {
        RunId  = "mcp-test-" + Guid.NewGuid().ToString("N")[..8],
        RunDir = string.Empty,
        Contract = new TaskContract(
            Persona: "test", Goal: "test", Topic: "test",
            Deliverables: "test", Scope: string.Empty, OutOfScope: string.Empty,
            QualityCriteria: string.Empty, Risk: "R1",
            ToolPermissions: "tools: *", Deadline: string.Empty),
        Playbook = new Playbook
        {
            Id = "test-pb", Title = "Test", DefaultPersona = "default",
            Steps = new System.Collections.Generic.List<PlaybookStep>(),
        },
        Db             = null,
        ToolEnabledMap = enabledMap,
    };

    public static JsonElement EmptyArgs()
    {
        using var doc = System.Text.Json.JsonDocument.Parse("{}");
        return doc.RootElement.Clone();
    }
}

// ── McpProxyTool testleri ─────────────────────────────────────────────────────

public class McpProxyToolTests
{
    private static McpToolRow MakeRow(
        string slug        = "srv__do_thing",
        string sideEffect  = "external",
        bool   reversible  = false,
        string minRisk     = "R3") => new(
            Slug:        slug,
            Name:        "Do Thing",
            Description: "Test aracı",
            InputSchema: JsonSerializer.SerializeToElement(new { type = "object" }),
            SideEffect:  sideEffect,
            Reversible:  reversible,
            MinRisk:     minRisk,
            McpToolName: "do_thing"
        );

    [Fact]
    public async Task InvokeAsync_Success_ReturnsOk()
    {
        var expected = JsonSerializer.SerializeToElement(new { answer = 42 });
        var client   = new FakeMcpClient(callResult: expected);
        var tool     = new McpProxyTool(MakeRow(), client);

        var result = await tool.InvokeAsync(
            McpTestHelpers.EmptyArgs(), McpTestHelpers.MakeCtx(), default);

        Assert.True(result.Ok);
        Assert.Equal("srv__do_thing", result.Slug);
        Assert.Equal(1, client.InvokeCallCount);
        Assert.Equal("do_thing", client.LastCalledTool);
    }

    [Fact]
    public async Task InvokeAsync_McpException_ReturnsFailure()
    {
        var client = new FakeMcpClient(callError: "sunucu hatası");
        var tool   = new McpProxyTool(MakeRow(), client);

        var result = await tool.InvokeAsync(
            McpTestHelpers.EmptyArgs(), McpTestHelpers.MakeCtx(), default);

        Assert.False(result.Ok);
        Assert.Contains("MCP araç hatası",  result.Error);
        Assert.Contains("sunucu hatası",     result.Error);
    }

    [Fact]
    public void Descriptor_ExternalNonReversible_NotAllowedInPhaseA()
    {
        var tool = new McpProxyTool(
            MakeRow(sideEffect: "external", reversible: false),
            new FakeMcpClient());
        Assert.False(tool.Descriptor.IsAllowedInPhaseA);
    }

    [Fact]
    public void Descriptor_ReadReversible_AllowedInPhaseA()
    {
        var tool = new McpProxyTool(
            MakeRow(sideEffect: "read", reversible: true),
            new FakeMcpClient());
        Assert.True(tool.Descriptor.IsAllowedInPhaseA);
    }

    [Fact]
    public void Descriptor_Category_IsUtility()
    {
        // tools.category CHECK('search','communication','calendar','storage','code','data','utility')
        // McpProxyTool her zaman 'utility' kullanır — 'mcp'/'external' CHECK kısıtı patlatır.
        var tool = new McpProxyTool(MakeRow(), new FakeMcpClient());
        Assert.Equal("utility", tool.Descriptor.Category);
    }
}

// ── ToolExecutor + McpProxyTool entegrasyon testleri ─────────────────────────

public class McpToolExecutorTests
{
    private static McpProxyTool MakeMcpTool(string slug, string sideEffect = "read", bool reversible = true)
    {
        var row = new McpToolRow(
            Slug:        slug,
            Name:        slug,
            Description: null,
            InputSchema: JsonSerializer.SerializeToElement(new { type = "object" }),
            SideEffect:  sideEffect,
            Reversible:  reversible,
            MinRisk:     "R0",
            McpToolName: slug
        );
        return new McpProxyTool(row, new FakeMcpClient());
    }

    /// <summary>
    /// (MCP-a) MCP aracı ToolEnabledMap'te disabled → Blocked + hata mesajı "devre dışı" içerir.
    /// </summary>
    [Fact]
    public async Task McpTool_Disabled_ReturnsBlocked()
    {
        var mcpTool  = MakeMcpTool("srv__search", sideEffect: "read", reversible: true);
        var executor = new ToolExecutor(
            new ITool[] { mcpTool },
            gate:   new FakeRiskGate(approve: true),
            budget: new FakeBudgetChecker(allowed: true));

        var enabledMap = new Dictionary<string, bool>(StringComparer.OrdinalIgnoreCase)
            { ["srv__search"] = false };
        var ctx    = McpTestHelpers.MakeCtx(enabledMap);
        var agent  = AgentsCatalog.All["Operator"];
        var result = await executor.ExecuteAsync(
            "srv__search", McpTestHelpers.EmptyArgs(), agent, ctx, default);

        Assert.False(result.Ok);
        Assert.Contains("devre dışı", result.Error, StringComparison.OrdinalIgnoreCase);
    }

    /// <summary>
    /// (MCP-b) external + !reversible → IsAllowedInPhaseA=false → AvailableFor listesinde görünmez.
    /// </summary>
    [Fact]
    public void McpTool_ExternalNonReversible_NotInAvailableFor()
    {
        var mcpTool  = MakeMcpTool("srv__send_email", sideEffect: "external", reversible: false);
        var executor = new ToolExecutor(new ITool[] { mcpTool });
        var agent    = AgentsCatalog.All["Operator"];
        var ctx      = McpTestHelpers.MakeCtx();

        var available = executor.AvailableFor(agent, ctx.Contract);

        Assert.DoesNotContain(available, d => d.Slug == "srv__send_email");
    }

    /// <summary>
    /// (MCP-c) external + !reversible → ExecuteAsync Faz A guard'ı → Blocked.
    /// </summary>
    [Fact]
    public async Task McpTool_ExternalNonReversible_ExecuteAsync_Blocked()
    {
        var mcpTool  = MakeMcpTool("srv__send_email", sideEffect: "external", reversible: false);
        var executor = new ToolExecutor(new ITool[] { mcpTool });
        var agent    = AgentsCatalog.All["Operator"];
        var ctx      = McpTestHelpers.MakeCtx();

        var result = await executor.ExecuteAsync(
            "srv__send_email", McpTestHelpers.EmptyArgs(), agent, ctx, default);

        Assert.False(result.Ok);
        Assert.Contains("Faz A", result.Error);
    }

    /// <summary>
    /// (MCP-d) Sözleşme doldurulmuş (read+reversible) + enabled → başarılı çalışır.
    /// </summary>
    [Fact]
    public async Task McpTool_ReadReversible_Enabled_Succeeds()
    {
        var fakeClient = new FakeMcpClient(
            callResult: JsonSerializer.SerializeToElement(new { found = true }));
        var row = new McpToolRow("srv__lookup", "Lookup", null,
            JsonSerializer.SerializeToElement(new { type = "object" }),
            "read", true, "R0", "lookup");
        var mcpTool  = new McpProxyTool(row, fakeClient);
        var executor = new ToolExecutor(
            new ITool[] { mcpTool },
            gate:   new FakeRiskGate(approve: true),
            budget: new FakeBudgetChecker(allowed: true));

        var enabledMap = new Dictionary<string, bool> { ["srv__lookup"] = true };
        var ctx    = McpTestHelpers.MakeCtx(enabledMap);
        var agent  = AgentsCatalog.All["Operator"];
        var result = await executor.ExecuteAsync(
            "srv__lookup",
            JsonSerializer.SerializeToElement(new { q = "test" }),
            agent, ctx, default);

        Assert.True(result.Ok);
        Assert.Equal(1, fakeClient.InvokeCallCount);
    }

    /// <summary>
    /// (MCP-e) Bilinmeyen MCP aracı → "Bilinmeyen araç" failure.
    /// </summary>
    [Fact]
    public async Task McpTool_UnknownSlug_ReturnsBilinmeyen()
    {
        var executor = ToolExecutor.CreateDefault();
        var agent    = AgentsCatalog.All["Operator"];
        var ctx      = McpTestHelpers.MakeCtx();

        var result = await executor.ExecuteAsync(
            "srv__nonexistent", McpTestHelpers.EmptyArgs(), agent, ctx, default);

        Assert.False(result.Ok);
        Assert.Contains("Bilinmeyen", result.Error, StringComparison.OrdinalIgnoreCase);
    }
}
