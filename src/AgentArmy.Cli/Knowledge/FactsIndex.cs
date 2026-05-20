using System.Text;
using System.Text.Json;

namespace AgentArmy.Cli;

/// <summary>
/// Facts okuma indeksi — Supabase facts tablosuna gider, token-overlap skor verir,
/// top-N FactEntry döner. Tek hakikat kaynağı DB; yerel dosya tutulmaz.
/// </summary>
public sealed class FactsIndex
{
    private readonly SupabaseWriter _db;
    private readonly string _domainPack;

    public FactsIndex(SupabaseWriter db, string domainPack)
    {
        _db         = db;
        _domainPack = domainPack;
    }

    /// <summary>
    /// Verilen sorguyla ilgili facts'leri DB'den çeker, token-overlap skor verir,
    /// en yüksek skorlu maxFacts kaydı döner. Skor 0 olanlar elenir.
    ///
    /// Kapı 5: Çapraz-fonksiyon mod. <paramref name="includeCrossPack"/> true ise
    /// facts_pack_visibility tablosunda <c>visible_to_pack_id = _domainPack</c> olan
    /// kaynak pack'lerin facts'leri de aday havuzuna eklenir. Görünür pack listesi
    /// visible_packs_for() RPC'sinden alınır.
    /// </summary>
    public async Task<IReadOnlyList<FactEntry>> SearchAsync(
        string query,
        int maxFacts,
        CancellationToken ct,
        bool includeCrossPack = false)
    {
        if (string.IsNullOrWhiteSpace(query)) return Array.Empty<FactEntry>();

        var tokens = Tokenize(query);
        if (tokens.Count == 0) return Array.Empty<FactEntry>();

        // Görünür pack'ler: kendi pack'i + (opsiyonel) facts_pack_visibility ile izin verilenler.
        var packs = new List<string> { _domainPack };
        if (includeCrossPack)
        {
            try
            {
                var vis = await _db.SelectAsync(
                    "rpc/visible_packs_for",
                    $"p_pack_id={Uri.EscapeDataString(_domainPack)}",
                    ct);
                if (vis.ValueKind == JsonValueKind.Array)
                {
                    foreach (var el in vis.EnumerateArray())
                    {
                        if (el.TryGetProperty("pack_id", out var p) && p.ValueKind == JsonValueKind.String)
                        {
                            var s = p.GetString();
                            if (!string.IsNullOrWhiteSpace(s) && !packs.Contains(s!))
                                packs.Add(s!);
                        }
                    }
                }
            }
            catch (Exception ex)
            {
                Console.Error.WriteLine($"[FactsIndex] cross-pack visibility RPC hatası, sadece kendi pack: {ex.Message}");
            }
        }

        // PostgREST: domain_pack=in.(p1,p2,p3)
        var packList = string.Join(",", packs.Select(Uri.EscapeDataString));
        var q = $"domain_pack=in.({packList})" +
                "&order=confidence.desc,extracted_at.desc" +
                "&limit=200" +
                "&select=id,domain_pack,run_id,playbook_id,topic,claim,evidence_url,evidence_quote,source_title,source_domain,confidence,extracted_at";

        var json = await _db.SelectAsync("facts", q, ct);
        if (json.ValueKind != JsonValueKind.Array) return Array.Empty<FactEntry>();

        var scored = new List<(int Score, FactEntry Fact)>(json.GetArrayLength());
        foreach (var el in json.EnumerateArray())
        {
            var fact = TryMap(el);
            if (fact is null) continue;

            var hay = (fact.Claim + " " + fact.Topic + " " + fact.SourceDomain).ToLowerInvariant();
            var score = 0;
            foreach (var t in tokens)
                if (hay.Contains(t)) score++;

            if (score == 0) continue;
            scored.Add((score, fact));
        }

        return scored
            .OrderByDescending(x => x.Score)
            .ThenByDescending(x => x.Fact.Confidence)
            .Take(maxFacts)
            .Select(x => x.Fact)
            .ToArray();
    }

    private static FactEntry? TryMap(JsonElement el)
    {
        try
        {
            string S(string name) => el.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() ?? string.Empty : string.Empty;
            string? SN(string name) => el.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() : null;
            double D(string name) => el.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.Number ? v.GetDouble() : 0.0;
            DateTimeOffset T(string name)
            {
                if (!el.TryGetProperty(name, out var v) || v.ValueKind != JsonValueKind.String) return DateTimeOffset.MinValue;
                var s = v.GetString();
                return DateTimeOffset.TryParse(s, out var dt) ? dt : DateTimeOffset.MinValue;
            }

            return new FactEntry(
                Id:             S("id"),
                Topic:          S("topic"),
                Claim:          S("claim"),
                EvidenceUrl:    S("evidence_url"),
                EvidenceQuote:  S("evidence_quote"),
                SourceTitle:    SN("source_title"),
                SourceDomain:   S("source_domain"),
                Confidence:     D("confidence"),
                RunId:          S("run_id"),
                PlaybookId:     S("playbook_id"),
                ExtractedAtUtc: T("extracted_at")
            );
        }
        catch { return null; }
    }

    private static HashSet<string> Tokenize(string text)
    {
        var set = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        if (string.IsNullOrWhiteSpace(text)) return set;

        var sb = new StringBuilder();
        foreach (var ch in text.ToLowerInvariant())
        {
            if (char.IsLetterOrDigit(ch)) { sb.Append(ch); continue; }
            if (sb.Length > 2) set.Add(sb.ToString());
            sb.Clear();
        }
        if (sb.Length > 2) set.Add(sb.ToString());
        return set;
    }
}
