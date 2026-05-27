namespace AgentArmy.Cli;

/// <summary>
/// Çekirdek <see cref="Agent"/> + <see cref="PersonaProfile"/> overlay birleştirme kuralları:
/// <list>
///   <item>Bool davranış bayrakları (tri-state): persona explicit true/false ise persona kazanır;
///         persona null ise çekirdek değeri devralınır.</item>
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

    /// <summary>
    /// Tri-state merge: overlay HasValue ise persona değeri uygulanır (true veya false),
    /// HasValue değilse çekirdek değer devralınır. Persona explicit "false" yazarak çekirdek
    /// ajanın varsayılan davranışını kapatabilir (örn. Researcher'ın web_search'unu kapat).
    /// </summary>
    public static AgentBehaviors MergeBehaviors(AgentBehaviors core, AgentBehaviorsOverlay overlay) =>
        new()
        {
            RequiresWebSearch      = overlay.RequiresWebSearch      ?? core.RequiresWebSearch,
            RequiresFullContext    = overlay.RequiresFullContext    ?? core.RequiresFullContext,
            WritesToFacts          = overlay.WritesToFacts          ?? core.WritesToFacts,
            WritesToDecisions      = overlay.WritesToDecisions      ?? core.WritesToDecisions,
            CapturesVerifierReport = overlay.CapturesVerifierReport ?? core.CapturesVerifierReport,
            TriggersContrarian     = overlay.TriggersContrarian     ?? core.TriggersContrarian,
            AcceptsRubric          = overlay.AcceptsRubric          ?? core.AcceptsRubric,
            PrefersDomainAllowlist = overlay.PrefersDomainAllowlist ?? core.PrefersDomainAllowlist,
            CanUseTools            = overlay.CanUseTools            ?? core.CanUseTools,
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
