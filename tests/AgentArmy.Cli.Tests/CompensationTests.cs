using System.Text.Json;
using Xunit;

namespace AgentArmy.Cli.Tests;

// Compensation runtime birim testleri.
// DB yok (SupabaseWriter null) → mevcut null-Db tolerans deseniyle tutarlı.
// CompensationExecutor in-memory path (CompensateExchangesAsync) ve
// ICompensable implementasyonları doğrudan test edilir.

public class CompensationTests
{
    // ── Yardımcılar ────────────────────────────────────────────────────────

    /// <summary>Geçici dizin ve temizlik yönetimi.</summary>
    private static (string dir, string path) WriteTestFile(string name = "test.txt", string content = "hello")
    {
        var dir  = Path.Combine(Path.GetTempPath(), "aa_comp_test_" + Guid.NewGuid());
        Directory.CreateDirectory(dir);
        var path = Path.Combine(dir, name);
        File.WriteAllText(path, content);
        return (dir, path);
    }

    private static JsonElement Args(object obj)
    {
        var json = JsonSerializer.Serialize(obj);
        using var doc = JsonDocument.Parse(json);
        return doc.RootElement.Clone();
    }

    // ── FileStoreTool ───────────────────────────────────────────────────────

    [Fact]
    public async Task FileStoreTool_CompensateAsync_DeletesFile()
    {
        var (dir, path) = WriteTestFile();
        try
        {
            var tool   = new FileStoreTool();
            var result = await tool.CompensateAsync(path, db: null, ownerId: null, ct: default);

            Assert.True(result.Ok, result.Message);
            Assert.False(File.Exists(path), "Dosya silinmeli.");
        }
        finally { Directory.Delete(dir, recursive: true); }
    }

    [Fact]
    public async Task FileStoreTool_CompensateAsync_Idempotent_WhenFileAlreadyGone()
    {
        var tool   = new FileStoreTool();
        var result = await tool.CompensateAsync("/tmp/dosya_yok_" + Guid.NewGuid(), db: null, ownerId: null, ct: default);

        Assert.True(result.Ok, "Dosya zaten yoksa başarı dönmeli (idempotent).");
    }

    [Fact]
    public async Task FileStoreTool_CompensateAsync_FailsOnEmptyToken()
    {
        var tool   = new FileStoreTool();
        var result = await tool.CompensateAsync(string.Empty, db: null, ownerId: null, ct: default);

        Assert.False(result.Ok);
    }

    // ── PurchaseOrderTool ───────────────────────────────────────────────────

    [Fact]
    public async Task PurchaseOrderTool_CompensateAsync_LogsAndSucceeds_WithoutDb()
    {
        var tool  = new PurchaseOrderTool();
        var token = JsonSerializer.Serialize(new { order_id = "PO-TEST-001", product = "Kalem", quantity = 5 });

        var result = await tool.CompensateAsync(token, db: null, ownerId: null, ct: default);

        Assert.True(result.Ok, result.Message);
        Assert.Contains("PO-TEST-001", result.Message);
    }

    [Fact]
    public async Task PurchaseOrderTool_CompensateAsync_FailsOnBadToken()
    {
        var tool   = new PurchaseOrderTool();
        var result = await tool.CompensateAsync("not-json", db: null, ownerId: null, ct: default);

        Assert.False(result.Ok);
    }

    [Fact]
    public async Task PurchaseOrderTool_CompensateAsync_FailsOnEmptyToken()
    {
        var tool   = new PurchaseOrderTool();
        var result = await tool.CompensateAsync(string.Empty, db: null, ownerId: null, ct: default);

        Assert.False(result.Ok);
    }

    // ── CompensationExecutor — in-memory path (Orchestrator yolu) ───────────

    [Fact]
    public async Task CompensateExchangesAsync_DeletesFileForFileStoreTool()
    {
        var (dir, path) = WriteTestFile();
        try
        {
            var executor = new CompensationExecutor(new ITool[] { new FileStoreTool() });

            var call     = new ToolCall("file_store", Args(new { name = "test.txt", content = "x" }), "call-1");
            var result   = ToolResult.Success("file_store", compensationToken: path);
            var exchange = new ToolExchange(call, result);

            await executor.CompensateExchangesAsync(
                new[] { exchange },
                db: null, ownerId: null,
                runId: "test-run", agentId: "Operator",
                ct: default);

            Assert.False(File.Exists(path), "CompensateExchangesAsync dosyayı silmeli.");
        }
        finally { Directory.Delete(dir, recursive: true); }
    }

    [Fact]
    public async Task CompensateExchangesAsync_SkipsExchangesWithNoToken()
    {
        var executor = new CompensationExecutor(new ITool[] { new FileStoreTool() });

        var call     = new ToolCall("file_store", Args(new { name = "x.txt", content = "y" }), "call-2");
        var result   = ToolResult.Success("file_store"); // compensationToken = null
        var exchange = new ToolExchange(call, result);

        // Token olmadan exception fırlatmamamalı; sadece atlamalı.
        await executor.CompensateExchangesAsync(
            new[] { exchange },
            db: null, ownerId: null,
            runId: "test-run", agentId: "Operator",
            ct: default);
    }

    [Fact]
    public async Task CompensateExchangesAsync_SkipsNonCompensableTools()
    {
        var executor = new CompensationExecutor(new ITool[] { new WebScrapeTool() });

        var call     = new ToolCall("web_scrape", Args(new { url = "https://example.com" }), "call-3");
        var result   = ToolResult.Success("web_scrape", compensationToken: "some-token");
        var exchange = new ToolExchange(call, result);

        // WebScrapeTool ICompensable değil → atlamalı.
        await executor.CompensateExchangesAsync(
            new[] { exchange },
            db: null, ownerId: null,
            runId: "test-run", agentId: "Operator",
            ct: default);
    }

    // ── CompensationExecutor — DB yok, invocation path idempotency ─────────

    [Fact]
    public async Task CompensateInvocationAsync_FailsGracefully_WhenDbNull()
    {
        var executor = new CompensationExecutor(new ITool[] { new FileStoreTool() });
        var result   = await executor.CompensateInvocationAsync("some-id", db: null, ownerId: null, ct: default);

        Assert.False(result.Ok);
        Assert.Contains("DB", result.Message);
    }

    // ── FileStoreTool InvokeAsync → CompensateAsync round-trip ─────────────

    [Fact]
    public async Task FileStoreTool_InvokeAndCompensate_RoundTrip()
    {
        var tempDir = Path.Combine(Path.GetTempPath(), "aa_comp_rt_" + Guid.NewGuid());
        Directory.CreateDirectory(tempDir);
        try
        {
            var ctx = TestRunContext(tempDir);
            var tool = new FileStoreTool();

            var invokeArgs  = Args(new { name = "ozet.md", content = "Test içerik" });
            var invokeResult = await tool.InvokeAsync(invokeArgs, ctx, default);

            Assert.True(invokeResult.Ok, invokeResult.Error);
            Assert.NotNull(invokeResult.CompensationToken);

            var writtenPath = invokeResult.CompensationToken!;
            Assert.True(File.Exists(writtenPath), "Dosya yazılmış olmalı.");

            var compResult = await tool.CompensateAsync(writtenPath, db: null, ownerId: null, ct: default);
            Assert.True(compResult.Ok, compResult.Message);
            Assert.False(File.Exists(writtenPath), "Compensation sonrası dosya silinmeli.");
        }
        finally { Directory.Delete(tempDir, recursive: true); }
    }

    // ── Yardımcılar ────────────────────────────────────────────────────────

    private static RunContext TestRunContext(string runDir) => new()
    {
        RunId    = "test-run",
        RunDir   = runDir,
        Contract = new TaskContract(
            Persona:         "default",
            Goal:            "test",
            Topic:           "test",
            Deliverables:    "",
            Scope:           "",
            OutOfScope:      "",
            QualityCriteria: "",
            Risk:            "R1",
            ToolPermissions: "tools: file_store; max_calls: 3",
            Deadline:        ""),
        Playbook = new Playbook
        {
            Id            = "test",
            Title         = "Test",
            DefaultPersona = "default",
            Steps         = new List<PlaybookStep>(),
        },
        Db = null,
    };
}
