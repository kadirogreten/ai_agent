using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace AgentArmy.Cli;

public sealed class FakeLlmClient : ILlmClient
{
    private readonly Queue<LlmTurn>? _scriptedTurns;

    /// <summary>Varsayılan: deterministik heuristik (ilk turda ilk aracı çağırır, sonra metinle biter).</summary>
    public FakeLlmClient() { }

    /// <summary>Testler için: verilen turları sırayla döndürür — araç-döngüsü senaryolarının tam kontrolü.</summary>
    public FakeLlmClient(IEnumerable<LlmTurn> scriptedTurns)
    {
        _scriptedTurns = new Queue<LlmTurn>(scriptedTurns);
    }

    public Task<LlmResult> CompleteAsync(string systemPrompt, string userPrompt, CancellationToken cancellationToken)
    {
        var hash = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(systemPrompt + "\n" + userPrompt)))[..10];
        var text = $"(dry-run) deterministic-output:{hash}\n\n" +
                   "Bu çıktı bir LLM çağrısı değildir. `--dryRun false` ile gerçek LLM çalıştırılabilir.";
        // Fake token counts: prompt length / 4 approximation
        var tokensIn  = (systemPrompt.Length + userPrompt.Length) / 4;
        var tokensOut = text.Length / 4;
        return Task.FromResult(new LlmResult(text, "fake", tokensIn, tokensOut));
    }

    public Task<LlmTurn> CompleteWithToolsAsync(
        string systemPrompt,
        string userPrompt,
        IReadOnlyList<ToolDescriptor> tools,
        IReadOnlyList<ToolExchange> priorExchanges,
        string? primaryTool,
        CancellationToken cancellationToken)
    {
        // 1) Senaryolu turlar — testlerin tam, deterministik kontrolü.
        if (_scriptedTurns is not null)
        {
            var turn = _scriptedTurns.Count > 0
                ? _scriptedTurns.Dequeue()
                : LlmTurn.FromText("(dry-run) script tükendi.", "fake", 0, 0);
            return Task.FromResult(turn);
        }

        // 2) Varsayılan heuristik: ilk turda primaryTool (varsa) veya ilk aracı çağır.
        if (tools.Count > 0 && priorExchanges.Count == 0)
        {
            var target = !string.IsNullOrWhiteSpace(primaryTool)
                ? tools.FirstOrDefault(t => t.Slug.Equals(primaryTool, StringComparison.OrdinalIgnoreCase)) ?? tools[0]
                : tools[0];
            var call = new ToolCall(target.Slug, EmptyArgs(), "call_fake_1");
            return Task.FromResult(new LlmTurn(null, new[] { call }, "fake", 0, 0));
        }

        // 3) ...araç sonucu geldikten sonra (veya hiç araç yokken) metinle bitir.
        var summary = priorExchanges.Count > 0
            ? $"(dry-run) {priorExchanges.Count} araç çağrısı sonrası özet."
            : "(dry-run) araçsız yanıt.";
        return Task.FromResult(LlmTurn.FromText(summary, "fake", summary.Length / 4, 0));
    }

    private static JsonElement EmptyArgs()
    {
        using var doc = JsonDocument.Parse("{}");
        return doc.RootElement.Clone();
    }
}
