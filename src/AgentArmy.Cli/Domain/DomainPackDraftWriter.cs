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
        WriteIndented = false
    };

    /// <summary>
    /// Verilen run dizininde "scaffold" adımının çıktısını tarar,
    /// geçerli domain pack JSON bulursa <c>domain_pack_drafts</c> tablosuna yazar.
    /// Bulamazsa sessizce döner (hata fırlatmaz).
    /// </summary>
    /// <param name="supabase">Supabase bağlantı ayarları</param>
    /// <param name="runDir">İlgili playbook run dizini</param>
    /// <param name="sectorPrompt">Kullanıcının orijinal sektör açıklaması</param>
    /// <param name="runRequestId">İlgili Supabase run_requests.id (opsiyonel)</param>
    /// <param name="tenantId">Sahibinin auth.uid() (opsiyonel; null → service role ile yazar)</param>
    /// <param name="ct">Cancellation token</param>
    /// <returns>Oluşturulan draft UUID veya null</returns>
    public static async Task<string?> TryWriteAsync(
        LocalConfig.SupabaseConfigSection supabase,
        string runDir,
        string sectorPrompt,
        string? runRequestId = null,
        string? tenantId = null,
        CancellationToken ct = default)
    {
        if (!supabase.IsConfigured) return null;
        if (!Directory.Exists(runDir)) return null;

        // scaffold adımının çıktı dosyalarını bul
        var candidates = Directory.GetFiles(runDir, "scaffold.*.md")
            .Concat(Directory.GetFiles(runDir, "scaffold.md"))
            .ToList();

        if (candidates.Count == 0)
        {
            Console.Error.WriteLine("[DraftWriter] scaffold.*.md bulunamadı, taslak yazılmıyor.");
            return null;
        }

        string? rawJson = null;
        string? proposedPackId = null;
        string? proposedName = null;

        foreach (var file in candidates)
        {
            var content = await File.ReadAllTextAsync(file, Encoding.UTF8, ct);
            rawJson = ExtractJson(content);
            if (rawJson is not null) break;
        }

        if (rawJson is null)
        {
            Console.Error.WriteLine("[DraftWriter] Geçerli JSON bulunamadı, taslak yazılmıyor.");
            return null;
        }

        // Önerilen pack ID ve name'i JSON'dan çıkar
        try
        {
            using var doc = JsonDocument.Parse(rawJson);
            proposedPackId = doc.RootElement.TryGetProperty("id", out var idEl)
                ? idEl.GetString() : null;
            proposedName = doc.RootElement.TryGetProperty("name", out var nameEl)
                ? nameEl.GetString() : null;
        }
        catch { /* JSON parse hatası — yine de kaydet */ }

        // domain_pack_drafts INSERT
        var row = new
        {
            sector_prompt    = sectorPrompt,
            proposed_pack_id = proposedPackId,
            proposed_name    = proposedName,
            run_request_id   = string.IsNullOrWhiteSpace(runRequestId) ? (object?)null : runRequestId,
            tenant_id        = tenantId,
            status           = "pending",
            draft_json       = JsonSerializer.Deserialize<JsonElement>(rawJson, _jsonOpts),
        };

        using var http = BuildClient(supabase);

        var body = JsonSerializer.Serialize(row, _jsonOpts);
        var content2 = new StringContent(body, Encoding.UTF8, "application/json");
        content2.Headers.Add("Prefer", "return=representation");

        var url = $"{supabase.EffectiveUrl}/rest/v1/domain_pack_drafts";
        var resp = await http.PostAsync(url, content2, ct);

        if (!resp.IsSuccessStatusCode)
        {
            var err = await resp.Content.ReadAsStringAsync(ct);
            Console.Error.WriteLine($"[DraftWriter] DB write failed: {(int)resp.StatusCode} {err}");
            return null;
        }

        var result = await resp.Content.ReadAsStringAsync(ct);
        // Dönen satırdan ID'yi çıkar
        try
        {
            using var doc = JsonDocument.Parse(result);
            var arr = doc.RootElement;
            if (arr.ValueKind == JsonValueKind.Array && arr.GetArrayLength() > 0)
            {
                var draftId = arr[0].GetProperty("id").GetString();
                Console.WriteLine($"[DraftWriter] ✅ Taslak kaydedildi: draft_id={draftId}, pack_id={proposedPackId}");
                return draftId;
            }
        }
        catch { /* ID çıkarılamadı ama kayıt başarılıydı */ }

        Console.WriteLine($"[DraftWriter] ✅ Taslak kaydedildi (ID alınamadı).");
        return null;
    }

    // ── Yardımcılar ──────────────────────────────────────────

    private static HttpClient BuildClient(LocalConfig.SupabaseConfigSection supabase)
    {
        var http = new HttpClient();
        http.DefaultRequestHeaders.Add("apikey", supabase.EffectiveKey);
        http.DefaultRequestHeaders.Authorization =
            new AuthenticationHeaderValue("Bearer", supabase.EffectiveKey);
        return http;
    }

    /// <summary>
    /// Markdown içeriğinden JSON bloğunu çıkarır.
    /// Önce ```json ... ``` blok, sonra ham { ... } dener.
    /// </summary>
    private static string? ExtractJson(string text)
    {
        // ```json ... ``` bloğu
        var fenced = Regex.Match(text, @"```json\s*(\{[\s\S]*?\})\s*```", RegexOptions.Singleline);
        if (fenced.Success)
        {
            var candidate = fenced.Groups[1].Value.Trim();
            if (IsValidJson(candidate)) return candidate;
        }

        // ``` ... ``` (dil etiketi olmadan)
        var fencedAny = Regex.Match(text, @"```\s*(\{[\s\S]*?\})\s*```", RegexOptions.Singleline);
        if (fencedAny.Success)
        {
            var candidate = fencedAny.Groups[1].Value.Trim();
            if (IsValidJson(candidate)) return candidate;
        }

        // Ham JSON: metindeki ilk { ... } bloğunu bul
        var firstBrace = text.IndexOf('{');
        var lastBrace  = text.LastIndexOf('}');
        if (firstBrace >= 0 && lastBrace > firstBrace)
        {
            var candidate = text[firstBrace..(lastBrace + 1)].Trim();
            if (IsValidJson(candidate)) return candidate;
        }

        return null;
    }

    private static bool IsValidJson(string text)
    {
        try { JsonDocument.Parse(text); return true; }
        catch { return false; }
    }
}
