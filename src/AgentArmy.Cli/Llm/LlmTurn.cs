using System.Text.Json;

namespace AgentArmy.Cli;

// Faz A — Tool Invocation: LLM araç-farkında tur tipleri (PR3).
// Tasarım: docs/faz-a-tool-invocation-tasarim.md (§3.3)

/// <summary>
/// Modelin tek bir araç çağrısı talebi. <see cref="Args"/> ham JSON nesnesidir;
/// <see cref="CallId"/> modelin verdiği çağrı kimliğidir (sonucu eşlemek için).
/// </summary>
public sealed record ToolCall(string Slug, JsonElement Args, string CallId);

/// <summary>
/// Bir araç çağrısı + onun yürütme sonucu. Sonraki LLM turuna geri beslenir
/// (function_call + function_call_output olarak).
/// </summary>
public sealed record ToolExchange(ToolCall Call, ToolResult Result);

/// <summary>
/// Bir LLM turunun sonucu: ya araç çağrı(lar)ı (<see cref="ToolCalls"/>) ya da
/// nihai metin (<see cref="Text"/>). Döngü çağıran tarafındadır (Orchestrator, PR4).
/// </summary>
public sealed record LlmTurn(
    string? Text,
    IReadOnlyList<ToolCall> ToolCalls,
    string Model,
    int TokensIn,
    int TokensOut)
{
    public bool HasToolCalls => ToolCalls.Count > 0;

    public static LlmTurn FromText(string? text, string model, int tokensIn, int tokensOut) =>
        new(text, Array.Empty<ToolCall>(), model, tokensIn, tokensOut);

    public static LlmTurn FromText(LlmResult r) =>
        new(r.Text, Array.Empty<ToolCall>(), r.Model, r.TokensIn, r.TokensOut);
}
