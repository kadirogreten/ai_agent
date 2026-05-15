using System.Text.Json;

namespace AgentArmy.Cli;

/// <summary>
/// Global facts store — artık Supabase facts tablosuna yazar.
/// Dedup için ON CONFLICT (id) DO NOTHING Supabase tarafında handle edilir.
/// </summary>
public sealed class FactsStore
{
    private readonly SupabaseWriter _db;
    private readonly string _domainPack;

    public FactsStore(SupabaseWriter db, string domainPack)
    {
        _db         = db;
        _domainPack = domainPack;
    }

    public async Task<int> AppendUniqueAsync(IEnumerable<FactEntry> facts, CancellationToken ct)
    {
        var appended = 0;
        foreach (var f in facts)
        {
            await _db.InsertAsync("facts", new
            {
                id             = f.Id,
                domain_pack    = _domainPack,
                run_id         = f.RunId,
                playbook_id    = f.PlaybookId,
                topic          = f.Topic,
                claim          = f.Claim,
                evidence_url   = f.EvidenceUrl,
                evidence_quote = f.EvidenceQuote,
                source_title   = f.SourceTitle,
                source_domain  = f.SourceDomain,
                confidence     = f.Confidence,
                extracted_at   = f.ExtractedAtUtc
            }, ct);
            appended++;
        }
        return appended;
    }
}
