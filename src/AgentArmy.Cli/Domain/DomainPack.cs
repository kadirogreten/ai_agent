namespace AgentArmy.Cli;

public sealed class DomainPack
{
    public required string Id { get; init; }
    public required string RootDir { get; init; }
    public IReadOnlyList<string> AllowedDomains { get; init; } = Array.Empty<string>();
    public string? VerifierRubric { get; init; }

    public string PlaybooksDir => Path.Combine(RootDir, "domain-packs", Id, "playbooks");
}

public static class DomainPackLoader
{
    public static DomainPack? TryLoad(string repoRoot, string? id)
    {
        if (string.IsNullOrWhiteSpace(id)) return null;

        var packRoot = Path.Combine(repoRoot, "domain-packs", id);
        if (!Directory.Exists(packRoot)) return null;

        var allowedDomainsPath = Path.Combine(packRoot, "allowed-domains.txt");
        var allowedDomains = File.Exists(allowedDomainsPath)
            ? File.ReadAllLines(allowedDomainsPath)
                .Select(l => l.Trim())
                .Where(l => !string.IsNullOrWhiteSpace(l) && !l.StartsWith("#", StringComparison.Ordinal))
                .Distinct(StringComparer.OrdinalIgnoreCase)
                .ToArray()
            : Array.Empty<string>();

        var verifierRubricPath = Path.Combine(packRoot, "rubrics", "verifier.md");
        var rubric = File.Exists(verifierRubricPath) ? File.ReadAllText(verifierRubricPath) : null;

        return new DomainPack
        {
            Id = id,
            RootDir = repoRoot,
            AllowedDomains = allowedDomains,
            VerifierRubric = rubric
        };
    }
}

