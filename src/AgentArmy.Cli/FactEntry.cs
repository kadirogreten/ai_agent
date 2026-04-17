namespace AgentArmy.Cli;

public sealed record FactEntry(
    string Id,
    string Topic,
    string Claim,
    string EvidenceUrl,
    string EvidenceQuote,
    string? SourceTitle,
    string SourceDomain,
    double Confidence,
    string RunId,
    string PlaybookId,
    DateTimeOffset ExtractedAtUtc
);

