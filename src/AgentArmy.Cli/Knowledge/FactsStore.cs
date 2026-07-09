using System.Text.Json;

namespace AgentArmy.Cli;

/// <summary>
/// Global facts store — Supabase facts tablosuna yazar.
/// D1c: embed-on-write + find_similar_fact / çelişki supersede.
/// </summary>
public sealed class FactsStore
{
    private readonly SupabaseWriter _db;
    private readonly string _domainPack;
    private readonly EmbeddingService? _embeddings;
    private readonly double _similarityThreshold;

    public FactsStore(
        SupabaseWriter db,
        string domainPack,
        EmbeddingService? embeddings = null,
        double similarityThreshold = 0.6)
    {
        _db                  = db;
        _domainPack          = domainPack;
        _embeddings          = embeddings;
        _similarityThreshold = similarityThreshold;
    }

    public async Task<int> AppendUniqueAsync(IEnumerable<FactEntry> facts, CancellationToken ct)
    {
        var appended = 0;
        foreach (var f in facts)
        {
            await AppendOneAsync(f, ct);
            appended++;
        }
        return appended;
    }

    private async Task AppendOneAsync(FactEntry f, CancellationToken ct)
    {
        float[]? vec = null;
        if (_embeddings?.IsConfigured == true)
            vec = await _embeddings.EmbedAsync(f.Claim, ct);

        // Trigram benzerliği ile çelişki tespiti
        var similarId = await FindSimilarFactIdAsync(f.Claim, ct);
        var newId     = string.IsNullOrWhiteSpace(f.Id) ? Guid.NewGuid().ToString() : f.Id;

        await _db.InsertAsync("facts", new
        {
            id             = newId,
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
            extracted_at   = f.ExtractedAtUtc,
            embedding      = vec is not null ? EmbeddingService.ToPgVectorLiteral(vec) : null,
            superseded_by  = (string?)null,
        }, ct);

        if (!string.IsNullOrWhiteSpace(similarId) && similarId != newId)
        {
            await _db.PatchAsync(
                "facts",
                $"id=eq.{Uri.EscapeDataString(similarId)}",
                new { superseded_by = newId },
                ct);
            Console.Error.WriteLine($"[FactsStore] çelişki supersede: {similarId} → {newId}");
        }
    }

    private async Task<string?> FindSimilarFactIdAsync(string claim, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(claim)) return null;

        try
        {
            var result = await _db.CallRpcReturningAsync("find_similar_fact", new
            {
                p_domain_pack = _domainPack,
                p_content     = claim,
                p_threshold   = _similarityThreshold,
            }, ct);

            if (result.ValueKind == JsonValueKind.String)
                return result.GetString();

            return null;
        }
        catch
        {
            return null;
        }
    }
}
