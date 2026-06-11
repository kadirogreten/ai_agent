using System.Collections.Concurrent;
using System.Text.Json;

namespace AgentArmy.Cli;

/// <summary>
/// policy_settings tablosundan yapılandırma değeri okur.
/// Önce owner satırı, sonra global (NULL) satır aranır; DB yoksa veya parse hatası olursa fallback döner.
/// 5 dakika in-memory cache; thread-safe.
/// </summary>
public static class PolicyReader
{
    private sealed record CacheEntry(string RawJson, DateTime Expiry);

    // cache key: "ownerId|key" veya "|key" (global)
    private static readonly ConcurrentDictionary<string, CacheEntry> _cache = new();
    private static readonly TimeSpan CacheTtl = TimeSpan.FromMinutes(5);

    /// <summary>
    /// owner→global fallback zinciriyle değer okur.
    /// DB yoksa veya tablo erişim hatası varsa <paramref name="fallback"/> döner.
    /// Parse hatası varsa da <paramref name="fallback"/> döner (sessiz).
    /// </summary>
    public static async Task<T> GetAsync<T>(
        SupabaseWriter? db,
        string? ownerId,
        string key,
        T fallback,
        CancellationToken ct)
    {
        if (db is null) return fallback;

        // Önce owner satırı, sonra global satır dene
        var candidates = new List<string?>();
        if (!string.IsNullOrWhiteSpace(ownerId)) candidates.Add(ownerId);
        candidates.Add(null); // global fallback

        foreach (var owner in candidates)
        {
            var raw = await FetchRawAsync(db, owner, key, ct);
            if (raw is null) continue;

            try
            {
                var parsed = JsonSerializer.Deserialize<T>(raw);
                return parsed is null ? fallback : parsed;
            }
            catch
            {
                // Parse hatası: bu owner için sessizce geç, global'ı dene
                continue;
            }
        }

        return fallback;
    }

    private static async Task<string?> FetchRawAsync(
        SupabaseWriter db,
        string? ownerId,
        string key,
        CancellationToken ct)
    {
        var cacheKey = $"{ownerId ?? string.Empty}|{key}";
        if (_cache.TryGetValue(cacheKey, out var entry) && entry.Expiry > DateTime.UtcNow)
            return entry.RawJson;

        try
        {
            // SupabaseWriter.SelectAsync ile: policy_settings?select=value&key=eq.<key>&owner_user_id=eq.<id>
            // owner IS NULL için özel filtre gerekiyor — raw RPC kullanıyoruz.
            // Alternatif: ayrı bir okuma RPC'si; ama SupabaseWriter.SelectAsync parametreleri destekliyorsa onu kullan.
            // Gerçek implementasyon: REST GET ile filtre.
            var filter = ownerId is not null
                ? $"key=eq.{Uri.EscapeDataString(key)}&owner_user_id=eq.{Uri.EscapeDataString(ownerId)}&select=value&limit=1"
                : $"key=eq.{Uri.EscapeDataString(key)}&owner_user_id=is.null&select=value&limit=1";

            // SelectAsync bir JSON array döner: [{"value": ...}]
            var result = await db.SelectAsync("policy_settings", filter, ct);
            if (result.ValueKind != JsonValueKind.Array) return null;
            var arr = result.EnumerateArray().ToList();
            if (arr.Count == 0) return null;

            var row = arr[0];
            if (row.ValueKind != JsonValueKind.Object) return null;
            if (!row.TryGetProperty("value", out var valEl)) return null;

            var raw = valEl.GetRawText();
            _cache[cacheKey] = new CacheEntry(raw, DateTime.UtcNow.Add(CacheTtl));
            return raw;
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine($"[PolicyReader] policy_settings okunamadı (key={key}, owner={ownerId}): {ex.Message}");
            return null;
        }
    }

    /// <summary>Test veya ayar değişikliği için cache'i temizle.</summary>
    public static void InvalidateCache() => _cache.Clear();
}
