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
}
