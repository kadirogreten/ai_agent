namespace AgentArmy.Cli;

/// <summary>
/// Çekirdek <see cref="Agent"/> + <see cref="PersonaProfile"/> overlay birleştirme kuralları:
/// <list>
///   <item>Bool davranış bayrakları: OR (persona veya çekirdek açıksa açık).</item>
///   <item><see cref="Agent.RiskCeiling"/>: dar olan kazanır (R0 &lt; R1 &lt; R2 &lt; R3).</item>
///   <item><see cref="Agent.CostClass"/>: persona doluysa persona, değilse çekirdek.</item>
/// </list>
/// </summary>
public static class AgentBehaviorMerge
{
    public static Agent Apply(Agent core, PersonaProfile persona)
    {
        if (!persona.HasBehaviorsOverlay
            && string.IsNullOrWhiteSpace(persona.CostClass)
            && RiskPolicy.Rank(persona.RiskCeiling) >= RiskPolicy.Rank(core.RiskCeiling))
        {
            return core;
        }

        var mergedBehaviors = persona.HasBehaviorsOverlay
            ? MergeBehaviors(core.Behaviors, persona.BehaviorsOverlay!)
            : core.Behaviors;

        var ceiling = TighterRiskCeiling(core.RiskCeiling, persona.RiskCeiling);
        var costClass = !string.IsNullOrWhiteSpace(persona.CostClass)
            ? persona.CostClass.Trim()
            : core.CostClass;

        return core with
        {
            Behaviors   = mergedBehaviors,
            RiskCeiling = ceiling,
            CostClass   = costClass
        };
    }

    public static AgentBehaviors MergeBehaviors(AgentBehaviors core, AgentBehaviors overlay) =>
        new()
        {
            RequiresWebSearch      = core.RequiresWebSearch      || overlay.RequiresWebSearch,
            RequiresFullContext    = core.RequiresFullContext    || overlay.RequiresFullContext,
            WritesToFacts          = core.WritesToFacts          || overlay.WritesToFacts,
            WritesToDecisions      = core.WritesToDecisions      || overlay.WritesToDecisions,
            CapturesVerifierReport = core.CapturesVerifierReport || overlay.CapturesVerifierReport,
            TriggersContrarian     = core.TriggersContrarian     || overlay.TriggersContrarian,
            AcceptsRubric          = core.AcceptsRubric          || overlay.AcceptsRubric,
            PrefersDomainAllowlist = core.PrefersDomainAllowlist || overlay.PrefersDomainAllowlist,
        };

    public static string TighterRiskCeiling(string a, string b)
    {
        return RiskPolicy.Rank(a) <= RiskPolicy.Rank(b) ? NormalizeRisk(a) : NormalizeRisk(b);
    }

    private static string NormalizeRisk(string risk)
    {
        var r = (risk ?? "R1").Trim().ToUpperInvariant();
        return r is "R0" or "R1" or "R2" or "R3" ? r : "R1";
    }
}
