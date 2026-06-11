namespace AgentArmy.Cli;

/// <summary>PR10: llm_providers tablosundan okunan provider kaydı.</summary>
public sealed record LlmProviderRecord(
    string   Slug,
    string   DisplayName,
    string   ApiBase,
    string   ApiKeyEnv,
    string   ModelId,
    string   Kind,            // "openai" | "anthropic"
    string   Tier,            // "basic" | "standard" | "frontier"
    string   MaxDecisionRisk, // "R0" | "R1" | "R2" | "R3"
    bool     Enabled,
    string[] IsDefaultFor
);
