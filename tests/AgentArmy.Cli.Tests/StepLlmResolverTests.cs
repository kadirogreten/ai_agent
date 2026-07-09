using System.Net;
using System.Text;
using System.Text.Json;
using Xunit;

namespace AgentArmy.Cli.Tests;

public sealed class StepLlmResolverTests
{
    [Theory]
    [InlineData("low",    "basic")]
    [InlineData("medium", "standard")]
    [InlineData("high",   "frontier")]
    [InlineData(null,     "basic")]
    public void CostClassToTier_MapsCorrectly(string? costClass, string expectedTier)
    {
        Assert.Equal(expectedTier, LlmProviderResolver.CostClassToTier(costClass));
    }

    [Fact]
    public async Task ResolveForTierAsync_DbWithBasicRecord_ParsesProvider()
    {
        var json = JsonSerializer.Serialize(new[]
        {
            new
            {
                slug              = "gpt-4.1-mini-basic",
                display_name      = "GPT-4.1 Mini",
                api_base          = "https://api.openai.com",
                api_key_env       = "OPENAI_API_KEY",
                model_id          = "gpt-4.1-mini",
                kind              = "openai",
                tier              = "basic",
                max_decision_risk = "R1",
                enabled           = true,
                is_default_for    = Array.Empty<string>(),
            },
        });

        using var handler = new StubHttpHandler(HttpStatusCode.OK, json);
        using var db      = new SupabaseWriter("https://fake.supabase.co", "fake-key", handler);

        var result = await LlmProviderResolver.ResolveForTierAsync(db, "basic", CancellationToken.None);

        Assert.Equal("gpt-4.1-mini-basic", result.Slug);
        Assert.Equal("gpt-4.1-mini",       result.ModelId);
        Assert.Equal("basic",              result.Tier);
    }
}

public sealed class SideEffectInvocationGuardTests
{
    [Fact]
    public async Task NullDb_ReturnsFalse()
    {
        var result = await SideEffectInvocationGuard.HasSuccessfulWriteOrExternalAsync(
            null, "run-1", "step-1", CancellationToken.None);
        Assert.False(result);
    }

    [Fact]
    public async Task DbWithMatchingInvocation_ReturnsTrue()
    {
        var json = JsonSerializer.Serialize(new[] { new { id = "inv-1" } });
        using var handler = new StubHttpHandler(HttpStatusCode.OK, json);
        using var db      = new SupabaseWriter("https://fake.supabase.co", "fake-key", handler);

        var result = await SideEffectInvocationGuard.HasSuccessfulWriteOrExternalAsync(
            db, "run-abc", "operator-step", CancellationToken.None);

        Assert.True(result);
    }

    [Fact]
    public async Task DbEmptyArray_ReturnsFalse()
    {
        using var handler = new StubHttpHandler(HttpStatusCode.OK, "[]");
        using var db      = new SupabaseWriter("https://fake.supabase.co", "fake-key", handler);

        var result = await SideEffectInvocationGuard.HasSuccessfulWriteOrExternalAsync(
            db, "run-abc", "operator-step", CancellationToken.None);

        Assert.False(result);
    }
}

public sealed class UpgradeRetryStepSelectionTests
{
    [Fact]
    public void FindUpgradeRetryStep_SkipsVerifierAndContrarian()
    {
        var steps = new List<PlaybookStep>
        {
            new() { Id = "research", Agent = "Researcher", Goal = "g", Output = "o" },
            new() { Id = "write",    Agent = "Writer",     Goal = "g", Output = "o" },
            new() { Id = "contrarian", Agent = "Contrarian", Goal = "g", Output = "o" },
            new() { Id = "verify",   Agent = "Verifier",   Goal = "g", Output = "o" },
        };

        var retry = InvokeFindUpgradeRetryStep(steps, verifierStepIdx: 3);
        Assert.NotNull(retry);
        Assert.Equal("write", retry!.Id);
    }

    // Reflection-free test helper via duplicate logic
    private static PlaybookStep? InvokeFindUpgradeRetryStep(IReadOnlyList<PlaybookStep> steps, int verifierStepIdx)
    {
        for (var i = verifierStepIdx - 1; i >= 0; i--)
        {
            var s = steps[i];
            if (s.Agent.Equals("Verifier", StringComparison.OrdinalIgnoreCase)) continue;
            if (s.Agent.Equals("Contrarian", StringComparison.OrdinalIgnoreCase)) continue;
            if (s.Id.Equals("contrarian", StringComparison.OrdinalIgnoreCase)) continue;
            return s;
        }
        return null;
    }
}
