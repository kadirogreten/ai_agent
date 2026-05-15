using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace AgentArmy.Cli;

/// <summary>
/// DOMAIN_PACK_ARCHITECT adımının çıktısından domain pack JSON'ını çıkarır
/// ve <c>domain_pack_drafts</c> tablosuna yazar.
/// </summary>
public static class DomainPackDraftWriter
{
    private static readonly JsonSerializerOptions _jsonOpts = new()
    {
        PropertyNameCaseInsensitive = true,
        WriteIndented               = false
    };

    /// <summary>
    /// DB-first: run_outputs tablosundaki scaffold adımını okur,
    /// geçerli domain pack JSON bulursa domain_pack_drafts'a yazar.
    /// </summary>
    public static async Task<string?> TryWriteFromDbAsync(
        SupabaseWriter db,
        string runId,
        string sectorPrompt,
        string? runRequestId = null,
        CancellationToken ct = default)
    {
        // run_outputs'tan scaffold adımını sorgula
        var content = await FetchScaffoldContentAsync(db, runId, ct);
        if (content is null)
        {
            Console.Error.WriteLine("[DraftWriter] run_outputs'ta scaffold adımı bulunamadı.");
            return null;
        }

        return await WriteFromContentAsync(db, content, sectorPrompt, runRequestId, ct);
    }

    /// <summary>
    /// Dosya tabanlı eski yöntem — geriye dönük uyumluluk için korundu.
    /// Yeni kod TryWriteFromDbAsync kullanmalı.
    /// </summary>
    public static async Task<string?> TryWriteAsync(
        LocalConfig.SupabaseConfigSection supabase,
        string runDir,
        string sectorPrompt,
        string? runRequestId = null,
        string? tenantId     = null,
        CancellationToken ct = default)
    {
        if (!supabase.IsConfigured) return null;
        if (!Directory.Exists(runDir))
        {
            Console.Error.WriteLine($"[DraftWriter] runDir bulunamadı: {runDir}");
            return null;
        }

        var candidates = Directory.GetFiles(runDir, "scaffold.*.md")
            .Concat(Directory.GetFiles(runDir, "scaffold.md"))
            .ToList();

        if (candidates.Count == 0)
        {
            Console.Error.WriteLine("[DraftWriter] scaffold.*.md bulunamadı, taslak yazılmıyor.");
            return null;
        }

        string? rawContent = null;
        foreach (var file in candidates)
        {
            rawContent = await File.ReadAllTextAsync(file, Encoding.UTF8, ct);
            if (!string.IsNullOrWhiteSpace(rawContent)) break;
        }

        if (rawContent is null) return null;

        using var db = new SupabaseWriter(supabase.EffectiveUrl!, supabase.EffectiveKey!);
        return await WriteFromContentAsync(db, rawContent, sectorPrompt, runRequestId, ct);
    }

    // ── İç yardımcılar ──────────────────────────────────────────────────────

    private static async Task<string?> FetchScaffoldContentAsync(
        SupabaseWriter db,
        string runId,
        CancellationToken ct)
    {
        // SupabaseWriter'ın _base ve _key alanlarına erişemeyiz, bu yüzden
        // kendi HttpClient'ını kullanırız (DB'nin base URL'i ve key'i çevre değişkenlerinden)
        var baseUrl = Environment.GetEnvironmentVariable("SUPABASE_URL");
        var key     = Environment.GetEnvironmentVariable("SUPABASE_SERVICE_ROLE_KEY");
        if (string.IsNullOrWhiteSpace(baseUrl) || string.IsNullOrWhiteSpace(key)) return null;

        using var http = new HttpClient(HttpClientPool.SharedHandler, disposeHandler: false);
        var url = $"{baseUrl.TrimEnd('/')}/rest/v1/run_outputs" +
                  $"?run_id=eq.{Uri.EscapeDataString(runId)}" +
                  $"&step_id=eq.scaffold" +
                  $"&order=created_at.asc&limit=1&select=content_md";

        using var req = new HttpRequestMessage(HttpMethod.Get, url);
        req.Headers.Add("apikey",        key);
        req.Headers.Add("Authorization", $"Bearer {key}");

        var resp = await http.SendAsync(req, ct);
        if (!resp.IsSuccessStatusCode) return null;

        var json = await resp.Content.ReadAsStringAsync(ct);
        using var doc = JsonDocument.Parse(json);
        var arr = doc.RootElement;
        if (arr.ValueKind != JsonValueKind.Array || arr.GetArrayLength() == 0) return null;

        return arr[0].TryGetProperty("content_md", out var el) ? el.GetString() : null;
    }

    private static async Task<string?> WriteFromContentAsync(
        SupabaseWriter db,
        string content,
        string sectorPrompt,
        string? runRequestId,
        CancellationToken ct)
    {
        var rawJson = ExtractJson(content);
        if (rawJson is null)
        {
            Console.Error.WriteLine("[DraftWriter] Geçerli JSON bulunamadı, taslak yazılmıyor.");
            return null;
        }

        string? proposedPackId = null;
        string? proposedName   = null;
        try
        {
            using var doc = JsonDocument.Parse(rawJson);
            proposedPackId = doc.RootElement.TryGetProperty("id",   out var idEl)   ? idEl.GetString()   : null;
            proposedName   = doc.RootElement.TryGetProperty("name", out var nameEl) ? nameEl.GetString() : null;
        }
        catch { }

        // domain_pack_drafts INSERT — return=representation ile ID alıyoruz
        var baseUrl = Environment.GetEnvironmentVariable("SUPABASE_URL");
        var key     = Environment.GetEnvironmentVariable("SUPABASE_SERVICE_ROLE_KEY");
        if (string.IsNullOrWhiteSpace(baseUrl) || string.IsNullOrWhiteSpace(key)) return null;

        using var http = new HttpClient(HttpClientPool.SharedHandler, disposeHandler: false);
        var row = new
        {
            sector_prompt    = sectorPrompt,
            proposed_pack_id = proposedPackId,
            proposed_name    = proposedName,
            run_request_id   = string.IsNullOrWhiteSpace(runRequestId) ? (object?)null : runRequestId,
            status           = "pending",
            draft_json       = JsonSerializer.Deserialize<JsonElement>(rawJson, _jsonOpts),
        };

        var body = JsonSerializer.Serialize(row, _jsonOpts);
        using var req = new HttpRequestMessage(HttpMethod.Post, $"{baseUrl.TrimEnd('/')}/rest/v1/domain_pack_drafts")
        {
            Content = new StringContent(body, Encoding.UTF8, "application/json")
        };
        req.Headers.Add("apikey",        key);
        req.Headers.Add("Authorization", $"Bearer {key}");
        req.Headers.Add("Prefer",        "return=representation");

        var resp = await http.SendAsync(req, ct);
        if (!resp.IsSuccessStatusCode)
        {
            var err = await resp.Content.ReadAsStringAsync(ct);
            Console.Error.WriteLine($"[DraftWriter] DB write failed: {(int)resp.StatusCode} {err}");
            return null;
        }

        var result = await resp.Content.ReadAsStringAsync(ct);
        try
        {
            using var doc = JsonDocument.Parse(result);
            var arr = doc.RootElement;
            if (arr.ValueKind == JsonValueKind.Array && arr.GetArrayLength() > 0)
            {
                var draftId = arr[0].GetProperty("id").GetString();
                Console.WriteLine($"[DraftWriter] Taslak kaydedildi: draft_id={draftId}, pack_id={proposedPackId}");
                return draftId;
            }
        }
        catch { }

        Console.WriteLine("[DraftWriter] Taslak kaydedildi (ID alınamadı).");
        return null;
    }

    private static string? ExtractJson(string text)
    {
        var fenced = Regex.Match(text, @"```json\s*(\{[\s\S]*?\})\s*```", RegexOptions.Singleline);
        if (fenced.Success)
        {
            var c = fenced.Groups[1].Value.Trim();
            if (IsValidJson(c)) return c;
        }

        var fencedAny = Regex.Match(text, @"```\s*(\{[\s\S]*?\})\s*```", RegexOptions.Singleline);
        if (fencedAny.Success)
        {
            var c = fencedAny.Groups[1].Value.Trim();
            if (IsValidJson(c)) return c;
        }

        var firstBrace = text.IndexOf('{');
        var lastBrace  = text.LastIndexOf('}');
        if (firstBrace >= 0 && lastBrace > firstBrace)
        {
            var c = text[firstBrace..(lastBrace + 1)].Trim();
            if (IsValidJson(c)) return c;
        }

        return null;
    }

    private static bool IsValidJson(string text)
    {
        try { JsonDocument.Parse(text); return true; }
        catch { return false; }
    }
}
