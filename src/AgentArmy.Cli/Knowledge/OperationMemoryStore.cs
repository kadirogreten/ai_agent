using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace AgentArmy.Cli;

/// <summary>
/// Operasyon kapsamlı kalıcı bellek — operation_memory tablosuna yazar/okur.
/// Her run sonunda fact/decision/work üçlüsü eklenir; çelişen kayıt eskiyi supersede eder.
///
/// FK sıra kuralı: önce yeni kayıt INSERT (yeni id ile), sonra eski kayda PatchAsync.
/// (superseded_by henüz var olmayan id'yi referanslayamaz.)
///
/// Null-DB toleransı: db null ise tüm metodlar no-op / boş döner.
/// </summary>
public sealed class OperationMemoryStore
{
    private readonly SupabaseWriter? _db;
    private readonly string          _operationId;
    private readonly string?         _runId;

    public OperationMemoryStore(SupabaseWriter? db, string operationId, string? runId)
    {
        _db          = db;
        _operationId = operationId;
        _runId       = runId;
    }

    // ── yazma ─────────────────────────────────────────────────────────────────

    /// <summary>
    /// Verilen kind + content'i operation_memory'e ekler.
    /// Aynı kind + topic_key ile aktif kayıt varsa onu supersede eder.
    /// </summary>
    public async Task WriteMemoryAsync(string kind, string content, CancellationToken ct)
    {
        if (_db is null) return;
        if (string.IsNullOrWhiteSpace(content)) return;

        var topicKey = ComputeTopicKey(kind, content);
        var newId    = Guid.NewGuid().ToString();

        // Mevcut aktif kaydı bul (dedup indeksini kullanır)
        var existing = await _db.SelectAsync(
            "operation_memory",
            $"operation_id=eq.{Uri.EscapeDataString(_operationId)}" +
            $"&kind=eq.{Uri.EscapeDataString(kind)}" +
            $"&topic_key=eq.{Uri.EscapeDataString(topicKey)}" +
            "&superseded_by=is.null" +
            "&select=id" +
            "&limit=1",
            ct);

        string? oldId = null;
        if (existing.ValueKind == JsonValueKind.Array && existing.GetArrayLength() > 0)
        {
            var row = existing[0];
            oldId = row.TryGetProperty("id", out var idEl) && idEl.ValueKind == JsonValueKind.String
                ? idEl.GetString() : null;
        }

        // 1. Yeni kaydı INSERT et (superseded_by henüz null — FK sıra zorunluluğu)
        await _db.InsertAsync("operation_memory", new
        {
            id           = newId,
            operation_id = _operationId,
            kind,
            topic_key    = topicKey,
            content,
            source_run_id = _runId,
            superseded_by = (string?)null
        }, ct);

        // 2. Eski kaydın superseded_by kolonunu doldur (yeni id artık DB'de mevcut)
        if (!string.IsNullOrWhiteSpace(oldId))
        {
            await _db.PatchAsync(
                "operation_memory",
                $"id=eq.{Uri.EscapeDataString(oldId)}",
                new { superseded_by = newId },
                ct);
        }
    }

    // ── okuma ─────────────────────────────────────────────────────────────────

    /// <summary>
    /// Aktif (superseded_by IS NULL) bellek kayıtlarından prompt bloğu üretir.
    /// En yeni <paramref name="maxEntries"/> kayıt, oluşturulma sırasına göre.
    /// DB yoksa boş string döner.
    /// </summary>
    public async Task<string> BuildMemoryBlockAsync(int maxEntries, CancellationToken ct)
    {
        if (_db is null) return string.Empty;

        JsonElement rows;
        try
        {
            rows = await _db.SelectAsync(
                "operation_memory",
                $"operation_id=eq.{Uri.EscapeDataString(_operationId)}" +
                "&superseded_by=is.null" +
                "&select=kind,content" +
                "&order=created_at.desc" +
                $"&limit={maxEntries}",
                ct);
        }
        catch
        {
            return string.Empty;
        }

        if (rows.ValueKind != JsonValueKind.Array || rows.GetArrayLength() == 0)
            return string.Empty;

        var sb = new StringBuilder();
        foreach (var row in rows.EnumerateArray())
        {
            var kind    = row.TryGetProperty("kind",    out var k) ? k.GetString() : "?";
            var content = row.TryGetProperty("content", out var c) ? c.GetString() : string.Empty;
            if (string.IsNullOrWhiteSpace(content)) continue;

            // Çok uzun içeriği kes (prompt taşması önlemi)
            var preview = content.Length > 400 ? content[..400] + "…" : content;
            sb.Append('[').Append(kind).Append("] ").AppendLine(preview.Trim());
        }

        return sb.ToString();
    }

    // ── yardımcılar ───────────────────────────────────────────────────────────

    /// <summary>
    /// SHA256(kind + "::" + content_prefix_120) hex.
    /// Aynı önekli içerik aynı anahtarı üretir; farklı ifadeli çelişki v1 kapsamı dışı.
    /// </summary>
    public static string ComputeTopicKey(string kind, string content)
    {
        var prefix = content.Trim();
        if (prefix.Length > 120) prefix = prefix[..120];
        var input  = kind.ToLowerInvariant() + "::" + prefix;
        var bytes  = Encoding.UTF8.GetBytes(input);
        return Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant();
    }
}
