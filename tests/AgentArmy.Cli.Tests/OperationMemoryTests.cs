using Xunit;

namespace AgentArmy.Cli.Tests;

/// <summary>
/// OperationMemoryStore logic-only testleri (DB etkileşimi yok).
/// DB'li senaryolar (supersede zinciri, 30 limit) bitti kriterindeki duman testine bırakıldı.
/// Desen: PR1/PR2 testleriyle aynı — null-DB toleransı + deterministik iç mantık.
/// </summary>
public sealed class OperationMemoryTests
{
    // ── ComputeTopicKey testleri ──────────────────────────────────────────────

    [Fact]
    public void ComputeTopicKey_SameInput_ReturnsSameKey()
    {
        var k1 = OperationMemoryStore.ComputeTopicKey("fact", "Elma fiyatı 10 TL");
        var k2 = OperationMemoryStore.ComputeTopicKey("fact", "Elma fiyatı 10 TL");
        Assert.Equal(k1, k2);
    }

    [Fact]
    public void ComputeTopicKey_DifferentKind_ReturnsDifferentKey()
    {
        var factKey     = OperationMemoryStore.ComputeTopicKey("fact",     "İçerik");
        var decisionKey = OperationMemoryStore.ComputeTopicKey("decision", "İçerik");
        Assert.NotEqual(factKey, decisionKey);
    }

    [Fact]
    public void ComputeTopicKey_ContentTruncatedAt120Chars_SamePrefix_SameKey()
    {
        var short120  = new string('x', 120);
        var long200   = new string('x', 200); // aynı 120-char prefix
        var k1 = OperationMemoryStore.ComputeTopicKey("fact", short120);
        var k2 = OperationMemoryStore.ComputeTopicKey("fact", long200);
        Assert.Equal(k1, k2);
    }

    [Fact]
    public void ComputeTopicKey_IsHexString()
    {
        var key = OperationMemoryStore.ComputeTopicKey("decision", "Karar alındı");
        Assert.Matches("^[0-9a-f]{64}$", key);
    }

    // ── Null-DB no-op testleri ────────────────────────────────────────────────

    [Fact]
    public async Task WriteMemoryAsync_NullDb_DoesNotThrow()
    {
        var store = new OperationMemoryStore(db: null, operationId: "op-1", runId: "run-1");
        // Null-DB'de no-op; exception atmamalı
        await store.WriteMemoryAsync("fact", "herhangi bir içerik", CancellationToken.None);
    }

    [Fact]
    public async Task BuildMemoryBlockAsync_NullDb_ReturnsEmpty()
    {
        var store = new OperationMemoryStore(db: null, operationId: "op-1", runId: "run-1");
        var result = await store.BuildMemoryBlockAsync(30, CancellationToken.None);
        Assert.Equal(string.Empty, result);
    }

    [Fact]
    public async Task WriteMemoryAsync_EmptyContent_NullDb_DoesNotThrow()
    {
        var store = new OperationMemoryStore(db: null, operationId: "op-1", runId: "run-1");
        await store.WriteMemoryAsync("fact", string.Empty, CancellationToken.None);
        await store.WriteMemoryAsync("fact", "   ", CancellationToken.None);
    }
}
