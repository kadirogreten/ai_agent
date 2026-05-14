using System.Security.Cryptography;
using System.Text;

namespace AgentArmy.Cli;

public sealed class FakeLlmClient : ILlmClient
{
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
}
