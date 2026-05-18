namespace AgentArmy.Cli;

/// <summary>
/// Persona koordinasyon katmanı: prompt bağlamı + çekirdek ajana uygulanan sparse davranış overlay'i.
/// </summary>
public sealed record PersonaProfile(
    string Slug,
    string ContextMarkdown,
    AgentBehaviorsOverlay? BehaviorsOverlay,
    string RiskCeiling,
    string? CostClass)
{
    /// <summary>Davranış overlay yok; risk tavanı R3 (kısıt yok).</summary>
    public static PersonaProfile FromMarkdownOnly(string slug, string markdown) =>
        new(slug, markdown, null, "R3", null);

    public bool HasBehaviorsOverlay => BehaviorsOverlay is not null && BehaviorsOverlay.HasAnyFlag();
}
