using System.Text.Json;
using Xunit;

namespace AgentArmy.Cli.Tests;

// ── Test çiftleri ─────────────────────────────────────────────────────────────

/// <summary>
/// Deterministik RiskGate test çifti.
/// OwnerId env var'ına (RUN_OWNER_USER_ID) dayanmaz — tüm kararlar ctor'da sabitlenir.
/// </summary>
internal sealed class FakeRiskGate : IRiskGate
{
    private readonly bool    _approve;
    private readonly string? _reason;
    private readonly string? _queueId;

    public FakeRiskGate(bool approve, string? reason = null, string? queueId = null)
    {
        _approve = approve;
        _reason  = reason;
        _queueId = queueId;
    }

    public bool WasCalled { get; private set; }

    public Task<RiskGate.GateOutcome> GateForToolAsync(
        SupabaseWriter? db, string risk, string runId,
        string agentId, string toolSlug, object? args, CancellationToken ct)
    {
        WasCalled = true;
        return Task.FromResult(new RiskGate.GateOutcome(_approve, _reason, _queueId));
    }
}

/// <summary>Deterministik bütçe test çifti.</summary>
internal sealed class FakeBudgetChecker : IBudgetChecker
{
    private readonly bool    _allowed;
    private readonly string? _reason;

    public FakeBudgetChecker(bool allowed, string? reason = null)
    {
        _allowed = allowed;
        _reason  = reason;
    }

    public bool WasCalled { get; private set; }

    public Task<BudgetChecker.BudgetResult> ConsumeAsync(
        SupabaseWriter? db, string? ownerId, string scope, decimal amount, CancellationToken ct)
    {
        WasCalled = true;
        return Task.FromResult(new BudgetChecker.BudgetResult(_allowed, _reason));
    }
}

/// <summary>
/// Minimal ITool implementasyonu — sadece slug + descriptor + sabit ToolResult.
/// ToolPermissions.Parse("*") aracı izin listesinden geçirir.
/// </summary>
internal sealed class FakeTool : ITool
{
    private readonly ToolResult _fixedResult;

    public FakeTool(
        string         slug,
        ToolSideEffect sideEffect,
        bool           reversible,
        string         minRisk   = "R0",
        ToolResult?    result    = null)
    {
        Slug       = slug;
        Descriptor = new ToolDescriptor
        {
            Slug       = slug,
            Name       = slug,
            SideEffect = sideEffect,
            Reversible = reversible,
            MinRisk    = minRisk,
        };
        _fixedResult = result ?? ToolResult.Success(slug, JsonDocument.Parse("{}").RootElement);
    }

    public string         Slug       { get; }
    public ToolDescriptor Descriptor { get; }

    public Task<ToolResult> InvokeAsync(JsonElement args, RunContext ctx, CancellationToken ct)
        => Task.FromResult(_fixedResult);
}

// ── Yardımcılar ───────────────────────────────────────────────────────────────

file static class TestHelpers
{
    /// <summary>
    /// Null-DB, owner env var'sız RunContext — testler env'i asla set etmez.
    /// (e) senaryosunda OwnerId null olması FakeTool'un MinRisk=R2 descriptor'ıyla sağlanır;
    /// effRisk ise TaskContract.Risk'ten türer.
    /// </summary>
    public static RunContext MakeCtx(string risk = "R3") => new()
    {
        RunId    = "test-run-" + Guid.NewGuid().ToString("N")[..8],
        RunDir   = string.Empty,
        Contract = new TaskContract(
            Persona:         "test",
            Goal:            "test",
            Topic:           "test",
            Deliverables:    "test",
            Scope:           string.Empty,
            OutOfScope:      string.Empty,
            QualityCriteria: string.Empty,
            Risk:            risk,
            ToolPermissions: "tools: *",   // tüm araçlara izin
            Deadline:        string.Empty),
        Playbook = new Playbook
        {
            Id            = "test-pb",
            Title         = "Test",
            DefaultPersona = "default",
            Steps         = new System.Collections.Generic.List<PlaybookStep>(),
        },
        Db = null,  // null-DB
    };

    public static ToolExecutor MakeExecutor(
        ITool          tool,
        IRiskGate?     gate   = null,
        IBudgetChecker? budget = null)
        => new(new[] { tool }, gate, budget);

    public static JsonElement EmptyArgs()
    {
        using var doc = JsonDocument.Parse("{}");
        return doc.RootElement.Clone();
    }
}

// ── Testler ───────────────────────────────────────────────────────────────────

public sealed class ToolExecutorTests
{
    /// <summary>
    /// (a) R3 yan etkili araç, RiskGate reddedince result.Ok = false ve hata mesajı "Onay alınamadı" içerir.
    /// Test adı: gerçekten doğrulanan şeyi yansıtır (blocked result, kuyruk simüle edilmiyor).
    /// </summary>
    [Fact]
    public async Task R3_GateRejected_ReturnsBlocked()
    {
        var gate = new FakeRiskGate(approve: false, reason: "pending");
        var tool = new FakeTool("purchase_order_fake", ToolSideEffect.External, reversible: true);
        var exec = TestHelpers.MakeExecutor(tool, gate: gate);
        var ctx  = TestHelpers.MakeCtx("R3");

        var result = await exec.ExecuteAsync(tool.Slug, TestHelpers.EmptyArgs(), AgentsCatalog.All["Operator"], ctx, CancellationToken.None);

        Assert.False(result.Ok);
        Assert.Contains("Onay alınamadı", result.Error);
        Assert.True(gate.WasCalled);
    }

    /// <summary>
    /// (b) Read araç (SideEffect=Read) için gate çağrılmaz, otomatik başarılı geçer.
    /// </summary>
    [Fact]
    public async Task R0_ReadTool_SkipsGateAndSucceeds()
    {
        var gate = new FakeRiskGate(approve: false, reason: "should not be called");
        var tool = new FakeTool("web_scrape_fake", ToolSideEffect.Read, reversible: true);
        var exec = TestHelpers.MakeExecutor(tool, gate: gate);
        var ctx  = TestHelpers.MakeCtx("R0");

        var result = await exec.ExecuteAsync(tool.Slug, TestHelpers.EmptyArgs(), AgentsCatalog.All["Researcher"], ctx, CancellationToken.None);

        Assert.True(result.Ok);
        Assert.False(gate.WasCalled); // read araç → gate hiç çağrılmaz
    }

    /// <summary>
    /// (c) Reversible=false + SideEffect=Write → IsAllowedInPhaseA = false → Faz A güvenlik bloğu.
    /// Gate'e bile gitmeden engellenir.
    /// </summary>
    [Fact]
    public async Task IrreversibleWrite_BlockedAtPhaseA()
    {
        var gate = new FakeRiskGate(approve: true);
        var tool = new FakeTool("irrev_write", ToolSideEffect.Write, reversible: false);
        var exec = TestHelpers.MakeExecutor(tool, gate: gate);
        var ctx  = TestHelpers.MakeCtx("R1");

        var result = await exec.ExecuteAsync(tool.Slug, TestHelpers.EmptyArgs(), AgentsCatalog.All["Operator"], ctx, CancellationToken.None);

        Assert.False(result.Ok);
        Assert.Contains("Faz A", result.Error);
        Assert.False(gate.WasCalled); // gate'e ulaşmadan bloklandı
    }

    /// <summary>
    /// (d) Bütçe aşımı → gate'ten önce engellenir.
    /// IBudgetChecker koşulsuz çağrılır (ctx.Db null olsa bile) — guard kaldırıldı.
    /// </summary>
    [Fact]
    public async Task BudgetExceeded_BlockedBeforeGate()
    {
        var budget = new FakeBudgetChecker(allowed: false, reason: "amount_limit_exceeded");
        var gate   = new FakeRiskGate(approve: true);
        var tool   = new FakeTool("purchase_order_fake", ToolSideEffect.External, reversible: true);
        var exec   = TestHelpers.MakeExecutor(tool, gate: gate, budget: budget);
        var ctx    = TestHelpers.MakeCtx("R1"); // null-DB

        var result = await exec.ExecuteAsync(tool.Slug, TestHelpers.EmptyArgs(), AgentsCatalog.All["Operator"], ctx, CancellationToken.None);

        Assert.False(result.Ok);
        Assert.Contains("Bütçe aşıldı", result.Error);
        Assert.True(budget.WasCalled);
        Assert.False(gate.WasCalled); // bütçe blok gate'ten önce
    }

    /// <summary>
    /// (e) R2+ araç + "no-db bypass" → highRisk && bypassed → fail-closed.
    /// FakeTool MinRisk=R2 + TaskContract.Risk=R2; OwnerId env var'ına bağımlılık yok.
    /// "Üç yol (CLI/worker/CEO) aynı IToolExecutor'dan geçer" — bu tek test yeterli.
    /// </summary>
    [Fact]
    public async Task R2_NullDb_BypassAttempt_FailClosed()
    {
        // Gerçek RiskGate adapter'ı kullanıyoruz; null-DB → "no-db bypass" + Approved=true döner.
        // Ama highRisk (R2) + bypassed → ToolExecutor fail-closed yapar.
        var tool = new FakeTool("ext_tool", ToolSideEffect.External, reversible: true, minRisk: "R2");
        var exec = TestHelpers.MakeExecutor(tool); // adapter (gerçek RiskGate)
        var ctx  = TestHelpers.MakeCtx("R2");      // null-DB, OwnerId env set değil

        var result = await exec.ExecuteAsync(tool.Slug, TestHelpers.EmptyArgs(), AgentsCatalog.All["Operator"], ctx, CancellationToken.None);

        Assert.False(result.Ok);
        Assert.Contains("bypass", result.Error, StringComparison.OrdinalIgnoreCase);
    }
}
