namespace AgentArmy.Cli;

/// <summary>
/// RiskGate'in test edilebilir soyutlaması.
/// Üretim kodu RiskGateAdapter'ı (static RiskGate'e delege) kullanır;
/// testler FakeRiskGate ile deterministic senaryo çalıştırır.
/// </summary>
public interface IRiskGate
{
    Task<RiskGate.GateOutcome> GateForToolAsync(
        SupabaseWriter? db,
        string          risk,
        string          runId,
        string          agentId,
        string          toolSlug,
        object?         args,
        CancellationToken ct);
}

/// <summary>Static RiskGate'e delege eden üretim adaptörü.</summary>
public sealed class RiskGateAdapter : IRiskGate
{
    public Task<RiskGate.GateOutcome> GateForToolAsync(
        SupabaseWriter? db, string risk, string runId,
        string agentId, string toolSlug, object? args, CancellationToken ct)
        => RiskGate.GateForToolAsync(db, risk, runId, agentId, toolSlug, args, ct);
}
