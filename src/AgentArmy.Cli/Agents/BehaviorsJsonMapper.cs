using System.Text.Json;

namespace AgentArmy.Cli;

/// <summary>
/// agents/personas tablolarındaki <c>behaviors</c> JSONB → <see cref="AgentBehaviors"/>.
/// </summary>
public static class BehaviorsJsonMapper
{
    public static AgentBehaviors? TryMap(JsonElement? element)
    {
        if (element is null || element.Value.ValueKind is JsonValueKind.Null or JsonValueKind.Undefined)
            return null;

        if (element.Value.ValueKind != JsonValueKind.Object)
            return null;

        var dto = JsonSerializer.Deserialize<BehaviorsDto>(element.Value.GetRawText(), JsonOptions);
        if (dto is null) return null;

        if (!dto.HasAnyFlag()) return null;

        return new AgentBehaviors
        {
            RequiresWebSearch      = dto.RequiresWebSearch,
            RequiresFullContext    = dto.RequiresFullContext,
            WritesToFacts          = dto.WritesToFacts,
            WritesToDecisions      = dto.WritesToDecisions,
            CapturesVerifierReport = dto.CapturesVerifierReport,
            TriggersContrarian     = dto.TriggersContrarian,
            AcceptsRubric          = dto.AcceptsRubric,
            PrefersDomainAllowlist = dto.PrefersDomainAllowlist,
        };
    }

    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNameCaseInsensitive = true
    };

    private sealed class BehaviorsDto
    {
        public bool RequiresWebSearch      { get; set; }
        public bool RequiresFullContext    { get; set; }
        public bool WritesToFacts          { get; set; }
        public bool WritesToDecisions      { get; set; }
        public bool CapturesVerifierReport { get; set; }
        public bool TriggersContrarian     { get; set; }
        public bool AcceptsRubric          { get; set; }
        public bool PrefersDomainAllowlist { get; set; }

        public bool HasAnyFlag() =>
            RequiresWebSearch || RequiresFullContext || WritesToFacts || WritesToDecisions
            || CapturesVerifierReport || TriggersContrarian || AcceptsRubric || PrefersDomainAllowlist;
    }
}
