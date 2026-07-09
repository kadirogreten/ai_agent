using Xunit;

namespace AgentArmy.Cli.Tests;

/// <summary>D3b — ToolRanker semantic top-k + compensation muafiyeti.</summary>
public sealed class ToolRankerTests
{
    private static ToolDescriptor MakeTool(
        string slug,
        ToolSideEffect sideEffect = ToolSideEffect.None,
        string minRisk = "R2",
        string? compensation = null) => new()
    {
        Slug        = slug,
        Name        = slug,
        Description = slug,
        SideEffect  = sideEffect,
        MinRisk     = minRisk,
        Compensation = compensation,
        InputSchema = System.Text.Json.JsonSerializer.SerializeToElement(new { type = "object" }),
        OutputSchema = System.Text.Json.JsonSerializer.SerializeToElement(new { type = "object" }),
    };

    [Fact]
    public void ToolRanker_CompensationTool_NeverFilteredOut()
    {
        var available = Enumerable.Range(1, 20)
            .Select(i => MakeTool($"tool_{i:D2}", ToolSideEffect.Write, "R2"))
            .Append(MakeTool("ads_campaign_pause", ToolSideEffect.Write, "R2", compensation: "pause_campaign"))
            .ToList();

        var ranked = ToolRanker.Rank(available, "totally unrelated quantum physics topic", k: 8);

        Assert.Contains(ranked, t => t.Slug == "ads_campaign_pause");
        Assert.True(ranked.Count <= 8 + 1); // k + muaf
    }

    [Fact]
    public void ToolRanker_LowRiskRead_AlwaysIncluded()
    {
        var available = Enumerable.Range(1, 15)
            .Select(i => MakeTool($"misc_{i}", ToolSideEffect.Write, "R2"))
            .Append(MakeTool("link_check", ToolSideEffect.Read, "R0"))
            .ToList();

        var ranked = ToolRanker.Rank(available, "unrelated", k: 5);
        Assert.Contains(ranked, t => t.Slug == "link_check");
    }

    [Fact]
    public void ToolRanker_ZeroK_ReturnsAll()
    {
        var available = new[] { MakeTool("a"), MakeTool("b") };
        var ranked = ToolRanker.Rank(available, "topic", k: 0);
        Assert.Equal(2, ranked.Count);
    }

    [Fact]
    public void ToolRanker_IsAlwaysIncluded_Compensation()
    {
        var t = MakeTool("ads_campaign_pause", compensation: "x");
        Assert.True(ToolRanker.IsAlwaysIncluded(t));
    }
}
