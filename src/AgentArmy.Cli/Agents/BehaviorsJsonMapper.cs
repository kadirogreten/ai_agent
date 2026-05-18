using System.Text.Json;

namespace AgentArmy.Cli;

/// <summary>
/// agents/personas tablolarındaki <c>behaviors</c> JSONB → <see cref="AgentBehaviors"/>.
/// </summary>
public static class BehaviorsJsonMapper
{
    /// <summary>
    /// Persona behaviors JSONB → AgentBehaviorsOverlay (tri-state).
    /// JSON konvansiyonu:
    ///   {"requires_web_search": true}  → force-on
    ///   {"requires_web_search": false} → force-off (çekirdek açık olsa bile kapatır)
    ///   alanı yoksa veya null            → çekirdekten devral
    /// Snake_case ve camelCase ikisini de okur (BehaviorsDto property attribute'leriyle).
    /// </summary>
    public static AgentBehaviorsOverlay? TryMap(JsonElement? element)
    {
        if (element is null || element.Value.ValueKind is JsonValueKind.Null or JsonValueKind.Undefined)
            return null;

        if (element.Value.ValueKind != JsonValueKind.Object)
            return null;

        var overlay = new AgentBehaviorsOverlay
        {
            RequiresWebSearch      = ReadFlag(element.Value, "requires_web_search",       "requiresWebSearch"),
            RequiresFullContext    = ReadFlag(element.Value, "requires_full_context",     "requiresFullContext"),
            WritesToFacts          = ReadFlag(element.Value, "writes_to_facts",           "writesToFacts"),
            WritesToDecisions      = ReadFlag(element.Value, "writes_to_decisions",       "writesToDecisions"),
            CapturesVerifierReport = ReadFlag(element.Value, "captures_verifier_report",  "capturesVerifierReport"),
            TriggersContrarian     = ReadFlag(element.Value, "triggers_contrarian",       "triggersContrarian"),
            AcceptsRubric          = ReadFlag(element.Value, "accepts_rubric",            "acceptsRubric"),
            PrefersDomainAllowlist = ReadFlag(element.Value, "prefers_domain_allowlist",  "prefersDomainAllowlist"),
        };

        return overlay.HasAnyFlag() ? overlay : null;
    }

    private static bool? ReadFlag(JsonElement obj, params string[] propertyNames)
    {
        foreach (var name in propertyNames)
        {
            if (!obj.TryGetProperty(name, out var v)) continue;
            if (v.ValueKind == JsonValueKind.True)  return true;
            if (v.ValueKind == JsonValueKind.False) return false;
            // String "true"/"false" tolerasyonu (LLM bazen tırnak içinde döndürür)
            if (v.ValueKind == JsonValueKind.String)
            {
                var s = v.GetString();
                if (string.Equals(s, "true",  StringComparison.OrdinalIgnoreCase)) return true;
                if (string.Equals(s, "false", StringComparison.OrdinalIgnoreCase)) return false;
            }
        }
        return null;
    }
}
