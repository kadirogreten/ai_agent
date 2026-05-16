using Xunit;

namespace AgentArmy.Cli.Tests;

public class AgentBehaviorMergeTests
{
    private static Agent CoreResearcher() => new("Researcher", "Researcher", "core")
    {
        Behaviors   = new AgentBehaviors { RequiresWebSearch = false, PrefersDomainAllowlist = false },
        RiskCeiling = "R3",
        CostClass   = "low"
    };

    [Fact]
    public void MergeBehaviors_UsesOrForBoolFlags()
    {
        var core    = new AgentBehaviors { PrefersDomainAllowlist = false };
        var overlay = new AgentBehaviors { PrefersDomainAllowlist = true };
        var merged  = AgentBehaviorMerge.MergeBehaviors(core, overlay);
        Assert.True(merged.PrefersDomainAllowlist);
    }

    [Fact]
    public void Apply_PersonaAllowlistOverlay_EnablesResearcherAllowlist()
    {
        var persona = new PersonaProfile(
            "hukuk-muduru",
            "Hukuk bağlamı",
            new AgentBehaviors { PrefersDomainAllowlist = true },
            "R2",
            null);

        var effective = AgentBehaviorMerge.Apply(CoreResearcher(), persona);
        Assert.True(effective.Behaviors.PrefersDomainAllowlist);
        Assert.Equal("R2", effective.RiskCeiling);
    }

    [Fact]
    public void TighterRiskCeiling_PicksStricter()
    {
        Assert.Equal("R1", AgentBehaviorMerge.TighterRiskCeiling("R3", "R1"));
        Assert.Equal("R2", AgentBehaviorMerge.TighterRiskCeiling("R3", "R2"));
    }

    [Fact]
    public void EnforceTaskRisk_RejectsWhenTaskExceedsPersonaCeiling()
    {
        var persona = new PersonaProfile("p", "x", null, "R2", null);
        var ex = Assert.Throws<InvalidOperationException>(() =>
            RiskPolicy.EnforceTaskRiskAgainstPersonaCeiling("R3", persona));
        Assert.Contains("R3", ex.Message);
        Assert.Contains("R2", ex.Message);
    }

    [Fact]
    public void EnforceTaskRisk_AllowsWhenWithinCeiling()
    {
        var persona = new PersonaProfile("p", "x", null, "R2", null);
        RiskPolicy.EnforceTaskRiskAgainstPersonaCeiling("R2", persona);
        RiskPolicy.EnforceTaskRiskAgainstPersonaCeiling("R1", persona);
    }
}
