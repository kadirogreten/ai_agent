using System.Text;
using System.Text.Json;

namespace AgentArmy.Cli;

/// <summary>
/// Plain HttpClient Supabase REST yazıcı.
/// CLI'dan DB'ye fire-and-forget INSERT yapar; hata olursa sadece stderr'e yazar.
/// </summary>
public sealed class SupabaseWriter : IDisposable
{
    private static readonly JsonSerializerOptions _opts = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.SnakeCaseLower,
        DefaultIgnoreCondition = System.Text.Json.Serialization.JsonIgnoreCondition.WhenWritingNull
    };

    private readonly HttpClient _http;
    private readonly string _base;
    private readonly string _key;

    public SupabaseWriter(string baseUrl, string key)
    {
        _http = new HttpClient { Timeout = TimeSpan.FromSeconds(15) };
        _base = baseUrl.TrimEnd('/');
        _key  = key;
    }

    public static SupabaseWriter? TryCreate(LocalConfig.SupabaseConfigSection? cfg)
    {
        if (cfg?.IsConfigured != true) return null;
        return new SupabaseWriter(cfg.EffectiveUrl!, cfg.EffectiveKey!);
    }

    /// <summary>
    /// Verilen tabloya tek satır INSERT eder.
    /// Hata olursa stderr'e yazar; exception fırlatmaz.
    /// </summary>
    public async Task InsertAsync(string table, object row, CancellationToken ct)
    {
        try
        {
            var url  = $"{_base}/rest/v1/{table}";
            var json = JsonSerializer.Serialize(row, _opts);

            using var req = new HttpRequestMessage(HttpMethod.Post, url)
            {
                Content = new StringContent(json, Encoding.UTF8, "application/json")
            };
            req.Headers.Add("apikey",        _key);
            req.Headers.Add("Authorization", $"Bearer {_key}");
            req.Headers.Add("Prefer",        "return=minimal");

            var resp = await _http.SendAsync(req, ct);
            if (!resp.IsSuccessStatusCode)
            {
                var body = await resp.Content.ReadAsStringAsync(ct);
                Console.Error.WriteLine($"[SupabaseWriter] {table} INSERT {(int)resp.StatusCode}: {body[..Math.Min(200, body.Length)]}");
            }
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            Console.Error.WriteLine($"[SupabaseWriter] {table} hata: {ex.Message}");
        }
    }

    public void Dispose() => _http.Dispose();
}
