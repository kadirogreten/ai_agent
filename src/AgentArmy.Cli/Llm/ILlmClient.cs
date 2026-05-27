namespace AgentArmy.Cli;

/// <summary>
/// LLM çağrısının sonucu: metin + token kullanım metrikleri.
/// </summary>
public sealed record LlmResult(
    string Text,
    string Model,
    int TokensIn,
    int TokensOut
)
{
    public int TotalTokens => TokensIn + TokensOut;
}

public interface ILlmClient
{
    Task<LlmResult> CompleteAsync(string systemPrompt, string userPrompt, CancellationToken cancellationToken);

    /// <summary>
    /// Araç-farkında tek tur: model ya araç çağrısı talep eder ya da nihai metin döner.
    /// Çağrı→yürüt→geri besle döngüsü çağıran tarafındadır (Orchestrator, PR4).
    ///
    /// Varsayılan implementasyon araçları yok sayar ve <see cref="CompleteAsync"/>'e delege eder;
    /// böylece araç desteklemeyen istemciler (örn. FakeLlmClient eski davranış) kırılmaz.
    /// Araç destekleyen istemciler (OpenAiResponsesClient) bunu override eder.
    /// </summary>
    async Task<LlmTurn> CompleteWithToolsAsync(
        string systemPrompt,
        string userPrompt,
        IReadOnlyList<ToolDescriptor> tools,
        IReadOnlyList<ToolExchange> priorExchanges,
        CancellationToken cancellationToken)
    {
        var result = await CompleteAsync(systemPrompt, userPrompt, cancellationToken);
        return LlmTurn.FromText(result);
    }
}
