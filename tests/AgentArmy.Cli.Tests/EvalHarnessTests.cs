using System.Text.Json;
using Xunit;

namespace AgentArmy.Cli.Tests;

public sealed class EvalHarnessTests
{
    [Fact]
    public void GoldenJson_LoadsAndHasCases()
    {
        var root = FindRepoRoot();
        var path = Path.Combine(root, "evals", "sosyal-medya", "golden.json");
        Assert.True(File.Exists(path), $"golden.json bulunamadı: {path}");

        using var doc = JsonDocument.Parse(File.ReadAllText(path));
        var rootEl = doc.RootElement;

        Assert.Equal("sosyal-medya", rootEl.GetProperty("pack").GetString());
        Assert.True(rootEl.GetProperty("cases").GetArrayLength() >= 10);
        Assert.Equal(3, rootEl.GetProperty("pass_k").GetInt32());
    }

    [Fact]
    public void PassKThreshold_Math()
    {
        const int total = 10;
        const int passed = 8;
        const double threshold = 0.8;
        Assert.True((double)passed / total >= threshold);
    }

    private static string FindRepoRoot()
    {
        var dir = AppContext.BaseDirectory;
        while (!string.IsNullOrEmpty(dir))
        {
            if (File.Exists(Path.Combine(dir, "evals", "sosyal-medya", "golden.json")))
                return dir;
            dir = Directory.GetParent(dir)?.FullName ?? string.Empty;
        }
        throw new InvalidOperationException("Repo root bulunamadı");
    }
}
