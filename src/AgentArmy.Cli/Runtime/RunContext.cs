using System.Text;
using System.Text.Json;

namespace AgentArmy.Cli;

public sealed class RunContext
{
    public required string RunId { get; init; }
    public required string RunDir { get; init; }
    public required TaskContract Contract { get; init; }
    public required Playbook Playbook { get; init; }

    public string FactsPath => Path.Combine(RunDir, "facts.md");
    public string DecisionsPath => Path.Combine(RunDir, "decisions.md");
    public string WorkPath => Path.Combine(RunDir, "work.md");
    public string LogPath => Path.Combine(RunDir, "log.jsonl");

    public async Task AppendLogAsync(object evt, CancellationToken ct)
    {
        var line = JsonSerializer.Serialize(evt);
        await File.AppendAllTextAsync(LogPath, line + "\n", Encoding.UTF8, ct);
    }

    public async Task AppendMarkdownAsync(string path, string title, string body, CancellationToken ct)
    {
        var sb = new StringBuilder();
        sb.AppendLine($"## {title}");
        sb.AppendLine();
        sb.AppendLine(body.Trim());
        sb.AppendLine();
        await File.AppendAllTextAsync(path, sb.ToString(), Encoding.UTF8, ct);
    }
}

