namespace AgentArmy.Cli;

public sealed record TaskContract(
    string Persona,
    string Goal,
    string Topic,
    string Deliverables,
    string Scope,
    string OutOfScope,
    string QualityCriteria,
    string Risk,
    string ToolPermissions,
    string Deadline
);

