namespace AgentArmy.Cli;

/// <summary>
/// Bütçe kontrolünün test edilebilir soyutlaması.
/// Null-DB toleransı adapter içinde kalır; ToolExecutor koşulsuz çağırır.
/// </summary>
public interface IBudgetChecker
{
    Task<BudgetChecker.BudgetResult> ConsumeAsync(
        SupabaseWriter? db,
        string?         ownerId,
        string          scope,
        decimal         amount,
        CancellationToken ct);
}

/// <summary>Static BudgetChecker.ConsumeAsync'e delege eden üretim adaptörü.</summary>
public sealed class BudgetCheckerAdapter : IBudgetChecker
{
    public Task<BudgetChecker.BudgetResult> ConsumeAsync(
        SupabaseWriter? db, string? ownerId, string scope, decimal amount, CancellationToken ct)
        => BudgetChecker.ConsumeAsync(db, ownerId, scope, amount, ct);
}
