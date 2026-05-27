namespace AgentArmy.Cli;

/// <summary>
/// IP1.7 Multi-LLM routing: ajan cost_class'ına göre model seçer, hata durumunda fallback uygular.
/// 
/// Model haritası (env override'lar öncelikli):
///   low    → AGENTARMY_MODEL_LOW    ?? "gpt-4.1-mini"
///   medium → AGENTARMY_MODEL_MEDIUM ?? "gpt-4.1"
///   high   → AGENTARMY_MODEL_HIGH   ?? "gpt-4.1"
/// 
/// Fallback zinciri: primary → medium → low (bütçe sınırı/rate-limit hatalarında)
/// </summary>
public sealed class LlmRouter : ILlmClient
{
    // cost_class → model adı çözümleme
    public static string ModelForCostClass(string? costClass)
    {
        var low    = Env("AGENTARMY_MODEL_LOW",    "gpt-4.1-mini");
        var medium = Env("AGENTARMY_MODEL_MEDIUM", "gpt-4.1");
        var high   = Env("AGENTARMY_MODEL_HIGH",   "gpt-4.1");

        return costClass?.ToLowerInvariant() switch
        {
            "high"   => high,
            "medium" => medium,
            _        => low,    // "low" veya tanımsız → en ucuz
        };
    }

    private static string Env(string key, string fallback)
        => Environment.GetEnvironmentVariable(key) is { Length: > 0 } v ? v : fallback;

    // ─── Instance üyeleri ───────────────────────────────────────────────
    private readonly ILlmClient _primary;
    private readonly ILlmClient? _fallback;
    private readonly string _primaryModel;

    public LlmRouter(ILlmClient primary, string primaryModel, ILlmClient? fallback = null)
    {
        _primary      = primary;
        _primaryModel = primaryModel;
        _fallback     = fallback;
    }

    public async Task<LlmResult> CompleteAsync(
        string systemPrompt,
        string userPrompt,
        CancellationToken cancellationToken)
    {
        try
        {
            return await _primary.CompleteAsync(systemPrompt, userPrompt, cancellationToken);
        }
        catch (InvalidOperationException ex) when (_fallback is not null && IsRetryableError(ex.Message))
        {
            Console.Error.WriteLine(
                $"[LlmRouter] {_primaryModel} failed ({TruncateMsg(ex.Message)}), falling back…");
            return await _fallback.CompleteAsync(systemPrompt, userPrompt, cancellationToken);
        }
    }

    public async Task<LlmTurn> CompleteWithToolsAsync(
        string systemPrompt,
        string userPrompt,
        IReadOnlyList<ToolDescriptor> tools,
        IReadOnlyList<ToolExchange> priorExchanges,
        CancellationToken cancellationToken)
    {
        try
        {
            return await _primary.CompleteWithToolsAsync(systemPrompt, userPrompt, tools, priorExchanges, cancellationToken);
        }
        catch (InvalidOperationException ex) when (_fallback is not null && IsRetryableError(ex.Message))
        {
            Console.Error.WriteLine(
                $"[LlmRouter] {_primaryModel} failed ({TruncateMsg(ex.Message)}), falling back…");
            return await _fallback.CompleteWithToolsAsync(systemPrompt, userPrompt, tools, priorExchanges, cancellationToken);
        }
    }

    // Rate limit, quota ve context-window aşımı → fallback
    private static bool IsRetryableError(string message)
    {
        return message.Contains("429", StringComparison.Ordinal)
            || message.Contains("rate_limit", StringComparison.OrdinalIgnoreCase)
            || message.Contains("quota", StringComparison.OrdinalIgnoreCase)
            || message.Contains("context_length_exceeded", StringComparison.OrdinalIgnoreCase)
            || message.Contains("overloaded", StringComparison.OrdinalIgnoreCase);
    }

    private static string TruncateMsg(string m) =>
        m.Length > 120 ? m[..120] + "…" : m;
}
