using System.Security.Cryptography;
using System.Text;

namespace AgentArmy.Cli;

public sealed class FakeLlmClient : ILlmClient
{
    public Task<string> CompleteAsync(string systemPrompt, string userPrompt, CancellationToken cancellationToken)
    {
        var hash = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(systemPrompt + "\n" + userPrompt)))[..10];
        var text = $"(dry-run) deterministic-output:{hash}\n\n" +
                   "Bu çıktı bir LLM çağrısı değildir. `--dryRun false` ile gerçek LLM çalıştırılabilir.";
        return Task.FromResult(text);
    }
}

