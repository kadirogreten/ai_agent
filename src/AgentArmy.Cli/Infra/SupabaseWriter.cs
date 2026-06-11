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
        // Paylaşılan handler — connection pool yeniden kullanılır.
        _http = HttpClientPool.FastWrite;
        _base = baseUrl.TrimEnd('/');
        _key  = key;
    }

    /// <summary>
    /// Test ctor: özel HttpMessageHandler enjekte eder (örn. stub yanıtlar için).
    /// Üretim kodu bu ctor'u kullanmaz; yalnızca test projelerinden erişilebilir.
    /// Bu ctor HttpClient'ı dispose eder — paylaşımlı handler değildir.
    /// </summary>
    internal SupabaseWriter(string baseUrl, string key, HttpMessageHandler handler)
    {
        _http = new HttpClient(handler, disposeHandler: true) { Timeout = TimeSpan.FromSeconds(15) };
        _base = baseUrl.TrimEnd('/');
        _key  = key;
        _ownHttp = true;
    }

    private readonly bool _ownHttp;

    public static SupabaseWriter? TryCreate(LocalConfig.SupabaseConfigSection? cfg)
    {
        if (cfg?.IsConfigured != true) return null;
        return new SupabaseWriter(cfg.EffectiveUrl!, cfg.EffectiveKey!);
    }

    /// <summary>
    /// Verilen tablodan PostgREST query string ile satırları okur. Service-role veya
    /// authenticated key gereklidir (RLS sayesinde tenant izolasyonu korunur).
    /// Örnek: SelectAsync("facts", "domain_pack=eq.market-intel&order=confidence.desc&limit=8", ct);
    /// </summary>
    public async Task<JsonElement> SelectAsync(string table, string query, CancellationToken ct)
    {
        try
        {
            var url = $"{_base}/rest/v1/{table}?{query}";

            using var resp = await HttpRetry.SendAsync(_http, () =>
            {
                var req = new HttpRequestMessage(HttpMethod.Get, url);
                req.Headers.Add("apikey",        _key);
                req.Headers.Add("Authorization", $"Bearer {_key}");
                req.Headers.Add("Accept",        "application/json");
                return req;
            }, ct);

            if (!resp.IsSuccessStatusCode)
            {
                var body = await resp.Content.ReadAsStringAsync(ct);
                Console.Error.WriteLine($"[SupabaseWriter] {table} SELECT {(int)resp.StatusCode}: {body[..Math.Min(200, body.Length)]}");
                return default;
            }

            var text = await resp.Content.ReadAsStringAsync(ct);
            if (string.IsNullOrWhiteSpace(text)) return default;
            return JsonSerializer.Deserialize<JsonElement>(text);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            Console.Error.WriteLine($"[SupabaseWriter] {table} SELECT hata: {ex.Message}");
            return default;
        }
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

            using var resp = await HttpRetry.SendAsync(_http, () =>
            {
                var req = new HttpRequestMessage(HttpMethod.Post, url)
                {
                    Content = new StringContent(json, Encoding.UTF8, "application/json")
                };
                req.Headers.Add("apikey",        _key);
                req.Headers.Add("Authorization", $"Bearer {_key}");
                req.Headers.Add("Prefer",        "return=minimal");
                return req;
            }, ct);

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

    /// <summary>
    /// Bir Postgres fonksiyonunu (RPC) çağırır: POST /rest/v1/rpc/{fn}. Gövde, fonksiyon
    /// parametre adlarıyla eşleşen bir JSON nesnesidir (null alanlar atlanır → SQL default).
    /// Fire-and-forget; hata olursa stderr'e yazar, exception fırlatmaz.
    /// </summary>
    public async Task CallRpcAsync(string fn, object args, CancellationToken ct)
    {
        try
        {
            var url  = $"{_base}/rest/v1/rpc/{fn}";
            var json = JsonSerializer.Serialize(args, _opts);

            using var resp = await HttpRetry.SendAsync(_http, () =>
            {
                var req = new HttpRequestMessage(HttpMethod.Post, url)
                {
                    Content = new StringContent(json, Encoding.UTF8, "application/json")
                };
                req.Headers.Add("apikey",        _key);
                req.Headers.Add("Authorization", $"Bearer {_key}");
                req.Headers.Add("Prefer",        "return=minimal");
                return req;
            }, ct);

            if (!resp.IsSuccessStatusCode)
            {
                var body = await resp.Content.ReadAsStringAsync(ct);
                Console.Error.WriteLine($"[SupabaseWriter] RPC {fn} {(int)resp.StatusCode}: {body[..Math.Min(200, body.Length)]}");
            }
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            Console.Error.WriteLine($"[SupabaseWriter] RPC {fn} hata: {ex.Message}");
        }
    }

    /// <summary>
    /// PostgREST DELETE: <c>DELETE /rest/v1/{table}?{query}</c>. <paramref name="query"/>
    /// filtreyi taşır (örn. <c>"slug=eq.x&amp;pack_id=eq.y&amp;tenant_id=is.null"</c>).
    /// Fire-and-forget; hata olursa stderr'e yazar, exception fırlatmaz.
    /// </summary>
    public async Task DeleteAsync(string table, string query, CancellationToken ct)
    {
        try
        {
            var url = $"{_base}/rest/v1/{table}?{query}";

            using var resp = await HttpRetry.SendAsync(_http, () =>
            {
                var req = new HttpRequestMessage(HttpMethod.Delete, url);
                req.Headers.Add("apikey",        _key);
                req.Headers.Add("Authorization", $"Bearer {_key}");
                req.Headers.Add("Prefer",        "return=minimal");
                return req;
            }, ct);

            if (!resp.IsSuccessStatusCode)
            {
                var body = await resp.Content.ReadAsStringAsync(ct);
                Console.Error.WriteLine($"[SupabaseWriter] {table} DELETE {(int)resp.StatusCode}: {body[..Math.Min(200, body.Length)]}");
            }
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            Console.Error.WriteLine($"[SupabaseWriter] {table} DELETE hata: {ex.Message}");
        }
    }

    /// <summary>
    /// Bir Postgres fonksiyonunu (RPC) çağırır ve dönen JSON'u okur.
    /// consume_budget gibi değer döndüren RPC'ler için kullanılır.
    /// Hata olursa stderr'e yazar, default JsonElement döner.
    /// </summary>
    public async Task<JsonElement> CallRpcReturningAsync(string fn, object args, CancellationToken ct)
    {
        try
        {
            var url  = $"{_base}/rest/v1/rpc/{fn}";
            var json = JsonSerializer.Serialize(args, _opts);

            using var resp = await HttpRetry.SendAsync(_http, () =>
            {
                var req = new HttpRequestMessage(HttpMethod.Post, url)
                {
                    Content = new StringContent(json, Encoding.UTF8, "application/json")
                };
                req.Headers.Add("apikey",        _key);
                req.Headers.Add("Authorization", $"Bearer {_key}");
                // return=representation yerine varsayılan (PostgREST JSON döner)
                return req;
            }, ct);

            if (!resp.IsSuccessStatusCode)
            {
                var body = await resp.Content.ReadAsStringAsync(ct);
                Console.Error.WriteLine($"[SupabaseWriter] RPC {fn} {(int)resp.StatusCode}: {body[..Math.Min(200, body.Length)]}");
                return default;
            }

            var text = await resp.Content.ReadAsStringAsync(ct);
            if (string.IsNullOrWhiteSpace(text)) return default;
            return JsonSerializer.Deserialize<JsonElement>(text);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            Console.Error.WriteLine($"[SupabaseWriter] RPC {fn} hata: {ex.Message}");
            return default;
        }
    }

    /// <summary>
    /// PostgREST PATCH: <c>PATCH /rest/v1/{table}?{query}</c>. <paramref name="query"/>
    /// filtreyi taşır (örn. <c>"id=eq.{uuid}"</c>). <paramref name="patch"/> güncellenen alanları içerir.
    /// Fire-and-forget; hata olursa stderr'e yazar, exception fırlatmaz.
    /// </summary>
    public async Task PatchAsync(string table, string query, object patch, CancellationToken ct)
    {
        try
        {
            var url  = $"{_base}/rest/v1/{table}?{query}";
            var json = JsonSerializer.Serialize(patch, _opts);

            using var resp = await HttpRetry.SendAsync(_http, () =>
            {
                var req = new HttpRequestMessage(HttpMethod.Patch, url)
                {
                    Content = new StringContent(json, Encoding.UTF8, "application/json")
                };
                req.Headers.Add("apikey",        _key);
                req.Headers.Add("Authorization", $"Bearer {_key}");
                req.Headers.Add("Prefer",        "return=minimal");
                return req;
            }, ct);

            if (!resp.IsSuccessStatusCode)
            {
                var body = await resp.Content.ReadAsStringAsync(ct);
                Console.Error.WriteLine($"[SupabaseWriter] {table} PATCH {(int)resp.StatusCode}: {body[..Math.Min(200, body.Length)]}");
            }
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            Console.Error.WriteLine($"[SupabaseWriter] {table} PATCH hata: {ex.Message}");
        }
    }

    /// <summary>
    /// Paylaşılan HttpClient kullandığı için burada dispose yok — IDisposable
    /// yalnızca eski `using var` çağrılarıyla uyumluluk için duruyor.
    /// </summary>
    public void Dispose() { if (_ownHttp) _http.Dispose(); }
}
