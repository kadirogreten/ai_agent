namespace AgentArmy.Cli;

/// <summary>
/// D1a: Adım-bazlı model router — ajan cost_class'ına göre tier seçer, LlmRouter döner.
/// Dry-run veya DB yoksa run-level varsayılan client kullanılır.
/// </summary>
public sealed class StepLlmResolver
{
    private readonly SupabaseWriter? _db;
    private readonly ILlmClient _runDefaultLlm;
    private readonly Dictionary<string, ILlmClient> _cache = new(StringComparer.OrdinalIgnoreCase);

    public StepLlmResolver(SupabaseWriter? db, ILlmClient runDefaultLlm)
    {
        _db            = db;
        _runDefaultLlm = runDefaultLlm;
    }

    /// <summary>
    /// Ajan için uygun LLM client'ı çözer. <paramref name="forceFrontier"/> upgrade-retry için.
    /// </summary>
    public async Task<ILlmClient> ResolveForAgentAsync(
        Agent agent,
        RunContext ctx,
        bool requiresWebSearch,
        bool forceFrontier,
        CancellationToken ct)
    {
        if (_db is null)
            return _runDefaultLlm;

        var tier = forceFrontier ? "frontier" : LlmProviderResolver.CostClassToTier(agent.CostClass);
        var cacheKey = requiresWebSearch ? $"{tier}:web" : tier;

        if (_cache.TryGetValue(cacheKey, out var cached))
            return cached;

        var provider = await LlmProviderResolver.ResolveForTierAsync(_db, tier, ct);

        if (LlmProviderResolver.RiskLevel(ctx.Contract.Risk) >
            LlmProviderResolver.RiskLevel(provider.MaxDecisionRisk))
        {
            provider = await LlmProviderResolver.ResolveAsync(_db, "run", ct);
        }

        // Her provider için ayrı HttpClient: OpenAiResponsesClient/AnthropicMessagesClient
        // ctor'da BaseAddress set eder; paylaşılan client ilk istekten sonra immutable olur
        // (InvalidOperationException: "Properties can only be modified before sending the first request").
        var baseLlm = LlmClientFactory.Create(NewLlmHttp(), provider, enableWebSearch: requiresWebSearch);

        ILlmClient? fallback = null;
        if (!string.Equals(tier, "basic", StringComparison.OrdinalIgnoreCase))
        {
            var basic = await LlmProviderResolver.ResolveForTierAsync(_db, "basic", ct);
            if (!string.Equals(basic.Slug, provider.Slug, StringComparison.OrdinalIgnoreCase))
                fallback = LlmClientFactory.Create(NewLlmHttp(), basic, enableWebSearch: requiresWebSearch);
        }

        var router = new LlmRouter(baseLlm, provider.ModelId, fallback);
        _cache[cacheKey] = router;
        return router;
    }

    private static HttpClient NewLlmHttp() =>
        new(HttpClientPool.SharedHandler, disposeHandler: false) { Timeout = TimeSpan.FromMinutes(5) };
}
