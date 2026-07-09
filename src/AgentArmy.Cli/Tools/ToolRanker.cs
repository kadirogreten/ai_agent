using System.Text.Json;

namespace AgentArmy.Cli;

/// <summary>
/// D3b: Semantic top-k araç sıralama. Compensation ve düşük-risk read araçları her zaman sunulur.
/// </summary>
public sealed class ToolRanker
{
    private readonly SupabaseWriter? _db;
    private readonly EmbeddingService? _embeddings;

    public ToolRanker(SupabaseWriter? db = null, EmbeddingService? embeddings = null)
    {
        _db         = db;
        _embeddings = embeddings;
    }

    /// <summary>
    /// k=0 → available değişmeden döner (geriye uyumlu).
    /// </summary>
    public async Task<IReadOnlyList<ToolDescriptor>> RankAsync(
        IReadOnlyList<ToolDescriptor> available,
        string topic,
        int k,
        CancellationToken ct)
    {
        if (k <= 0 || available.Count <= k)
            return available;

        var alwaysInclude = available.Where(IsAlwaysIncluded).ToList();
        var remaining     = available.Where(t => !IsAlwaysIncluded(t)).ToList();

        if (remaining.Count == 0)
            return alwaysInclude;

        var ranked = await RankRemainingAsync(remaining, topic, k, ct);
        var merged = new Dictionary<string, ToolDescriptor>(StringComparer.OrdinalIgnoreCase);
        foreach (var t in alwaysInclude) merged[t.Slug] = t;
        foreach (var t in ranked)        merged[t.Slug] = t;
        return merged.Values.ToList();
    }

    /// <summary>Test ve deterministik sıralama için senkron API.</summary>
    public static IReadOnlyList<ToolDescriptor> Rank(
        IReadOnlyList<ToolDescriptor> available,
        string topic,
        int k)
    {
        if (k <= 0 || available.Count <= k)
            return available;

        var alwaysInclude = available.Where(IsAlwaysIncluded).ToList();
        var remaining     = available.Where(t => !IsAlwaysIncluded(t)).ToList();
        if (remaining.Count == 0)
            return alwaysInclude;

        var queryTokens = Tokenize(topic);
        var scored = remaining
            .Select(t => (Tool: t, Score: ScoreTool(t, queryTokens)))
            .OrderByDescending(x => x.Score)
            .ThenBy(x => x.Tool.Slug, StringComparer.OrdinalIgnoreCase)
            .Take(k)
            .Select(x => x.Tool)
            .ToList();

        var merged = new Dictionary<string, ToolDescriptor>(StringComparer.OrdinalIgnoreCase);
        foreach (var t in alwaysInclude) merged[t.Slug] = t;
        foreach (var t in scored)        merged[t.Slug] = t;
        return merged.Values.ToList();
    }

    private async Task<IReadOnlyList<ToolDescriptor>> RankRemainingAsync(
        IReadOnlyList<ToolDescriptor> remaining,
        string topic,
        int k,
        CancellationToken ct)
    {
        if (_db is not null && _embeddings?.IsConfigured == true)
        {
            var vec = await _embeddings.EmbedAsync(topic, ct);
            if (vec is not null)
            {
                var bySlug = remaining.ToDictionary(t => t.Slug, StringComparer.OrdinalIgnoreCase);
                try
                {
                    var result = await _db.CallRpcReturningAsync("match_tools_by_embedding", new
                    {
                        p_embedding = EmbeddingService.ToPgVectorLiteral(vec),
                        p_limit     = k + remaining.Count,
                        p_threshold = 0.0,
                    }, ct);

                    if (result.ValueKind == JsonValueKind.Array && result.GetArrayLength() > 0)
                    {
                        var picked = new List<ToolDescriptor>();
                        foreach (var el in result.EnumerateArray())
                        {
                            if (!el.TryGetProperty("slug", out var slugEl)) continue;
                            var slug = slugEl.GetString();
                            if (string.IsNullOrWhiteSpace(slug)) continue;
                            if (bySlug.TryGetValue(slug, out var tool))
                                picked.Add(tool);
                            if (picked.Count >= k) break;
                        }
                        if (picked.Count > 0)
                            return picked;
                    }
                }
                catch (Exception ex)
                {
                    Console.Error.WriteLine($"[ToolRanker] vector arama hatası, token fallback: {ex.Message}");
                }
            }
        }

        return Rank(remaining, topic, k);
    }

    /// <summary>Compensation kayıtlı veya düşük-risk read araçları top-k'dan muaf.</summary>
    public static bool IsAlwaysIncluded(ToolDescriptor tool)
    {
        if (!string.IsNullOrWhiteSpace(tool.Compensation))
            return true;

        if (tool.SideEffect == ToolSideEffect.Read)
        {
            var r = (tool.MinRisk ?? "R1").Trim().ToUpperInvariant();
            if (r is "R0" or "R1")
                return true;
        }

        return false;
    }

    private static int ScoreTool(ToolDescriptor tool, HashSet<string> queryTokens)
    {
        var text = $"{tool.Slug} {tool.Name} {tool.Description}".ToLowerInvariant();
        var toolTokens = Tokenize(text);
        return queryTokens.Count(t => toolTokens.Contains(t));
    }

    private static HashSet<string> Tokenize(string text)
    {
        return text.ToLowerInvariant()
            .Split(new[] { ' ', '\t', '\n', ',', '.', '-', '_', '/', ':', ';' }, StringSplitOptions.RemoveEmptyEntries)
            .Where(w => w.Length > 2)
            .ToHashSet(StringComparer.OrdinalIgnoreCase);
    }
}
