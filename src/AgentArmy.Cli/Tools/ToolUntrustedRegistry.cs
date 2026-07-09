namespace AgentArmy.Cli;

/// <summary>
/// Untrusted araç slug kaydı — LLM istemcileri descriptor olmadan slug ile sarma yapar.
/// Builtin'ler varsayılan; MCP yüklemesinde DB satırından eklenir.
/// </summary>
public static class ToolUntrustedRegistry
{
    private static readonly HashSet<string> Slugs = new(StringComparer.OrdinalIgnoreCase)
    {
        "web_scrape",
        "social_inbox_fetch",
        "link_check",
    };

    public static bool IsUntrusted(string? slug)
        => !string.IsNullOrWhiteSpace(slug) && Slugs.Contains(slug.Trim());

    public static void Register(string slug)
    {
        if (!string.IsNullOrWhiteSpace(slug))
            Slugs.Add(slug.Trim());
    }
}
