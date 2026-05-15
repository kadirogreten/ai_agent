using System.Text;
using System.Text.Json;

namespace AgentArmy.Cli;

public sealed class RunContext
{
    public required string RunId    { get; init; }
    public required string RunDir   { get; init; }   // sadece image dosyaları için
    public required TaskContract Contract  { get; init; }
    public required Playbook     Playbook  { get; init; }
    public IReadOnlyList<string> SelectedAgents { get; init; } = Array.Empty<string>();
    public SupabaseWriter? Db { get; init; }

    /// <summary>RUN_OWNER_USER_ID env var'dan okunur; run_outputs ve run_events'e eklenir.</summary>
    public string? OwnerId => Environment.GetEnvironmentVariable("RUN_OWNER_USER_ID");

    // ── In-memory accumulators (disk yerine) ──────────────────────────────
    private readonly StringBuilder _work      = new("# Work\n\n");
    private readonly StringBuilder _facts     = new("# Facts\n\n");
    private readonly StringBuilder _decisions = new("# Decisions\n\n");

    public string GetWork()      => _work.ToString();
    public string GetFacts()     => _facts.ToString();
    public string GetDecisions() => _decisions.ToString();

    public void AppendWork(string title, string body)
        => AppendSection(_work, title, body);

    public void AppendFacts(string title, string body)
        => AppendSection(_facts, title, body);

    public void AppendDecisions(string title, string body)
        => AppendSection(_decisions, title, body);

    private static void AppendSection(StringBuilder sb, string title, string body)
    {
        sb.AppendLine($"## {title}");
        sb.AppendLine();
        sb.AppendLine(body.Trim());
        sb.AppendLine();
    }

    // ── Event log → run_events tablosu ────────────────────────────────────
    public async Task AppendLogAsync(object evt, CancellationToken ct)
    {
        if (Db is null) return;

        var json    = JsonSerializer.Serialize(evt);
        var element = JsonSerializer.Deserialize<JsonElement>(json);
        var type    = element.TryGetProperty("type", out var t) && t.ValueKind == JsonValueKind.String
            ? t.GetString() ?? "event"
            : "event";

        await Db.InsertAsync("run_events", new
        {
            run_id        = RunId,
            owner_user_id = OwnerId,
            event_type    = type,
            payload       = element
        }, ct);
    }
}
