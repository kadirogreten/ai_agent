using System.Text;
using System.Text.Json;

namespace AgentArmy.Cli;

// Tedarik otomasyonu — gerçek ürün/fiyat arama aracı.
// Model olgu/link kaynağı DEĞİLDİR; bu araç gerçek arama servislerine gider ve GERÇEK
// başlık + fiyat + satıcı + URL döner. Agent yalnız bu sonuçları yorumlar/karşılaştırır.
//
// Backend'ler (sırayla, fallback):
//   1) SerpAPI / Google Shopping  (env: SERPAPI_KEY)  — fiyatlı, yapılandırılmış
//   2) Tavily web search          (env: TAVILY_KEY)   — SerpAPI kotası bitince/başarısızsa
// İkisi de yoksa net hata döner (model uydurmaya geri dönmesin diye).

public sealed class ProductSearchTool : ITool
{
    public string Slug => "product_search";

    private const int DefaultResults = 6;
    private const int MaxResults     = 20;

    private static readonly JsonElement InputSchemaJson = Schema("""
    {
      "type": "object",
      "required": ["query"],
      "properties": {
        "query":       { "type": "string",  "description": "Aranacak ürün (örn. 'Asus VG249Q 24 inç monitör')" },
        "max_results": { "type": "integer", "default": 6, "minimum": 1, "maximum": 20 },
        "country":     { "type": "string",  "default": "tr", "description": "Ülke kodu (gl)" },
        "language":    { "type": "string",  "default": "tr", "description": "Dil kodu (hl)" }
      }
    }
    """);

    private static readonly JsonElement OutputSchemaJson = Schema("""
    {
      "type": "object",
      "properties": {
        "query":      { "type": "string" },
        "source_api": { "type": "string" },
        "count":      { "type": "integer" },
        "results":    { "type": "array" }
      }
    }
    """);

    public ToolDescriptor Descriptor => new()
    {
        Slug         = Slug,
        Name         = "Ürün Arama",
        Description  = "Gerçek arama servislerinden (SerpAPI/Google Shopping; yedek: Tavily) ürünleri getirir: başlık, fiyat, satıcı ve GERÇEK ürün URL'si. Fiyat/link uydurma; yalnız bu sonuçları kullan.",
        Category     = "search",
        SideEffect   = ToolSideEffect.Read,
        Reversible   = true,
        MinRisk      = "R0",
        InputSchema  = InputSchemaJson,
        OutputSchema = OutputSchemaJson,
    };

    public async Task<ToolResult> InvokeAsync(JsonElement args, RunContext ctx, CancellationToken ct)
    {
        if (args.ValueKind != JsonValueKind.Object ||
            !args.TryGetProperty("query", out var qEl) ||
            qEl.ValueKind != JsonValueKind.String ||
            string.IsNullOrWhiteSpace(qEl.GetString()))
        {
            return ToolResult.Failure(Slug, "Zorunlu 'query' argümanı (string) eksik.");
        }

        // Serper.dev anahtarı; geriye uyumluluk için SERPAPI_KEY env'i de okunur (aynı secret).
        var serperKey = Environment.GetEnvironmentVariable("SERPER_KEY")
                     ?? Environment.GetEnvironmentVariable("SERPAPI_KEY");
        var tavilyKey = Environment.GetEnvironmentVariable("TAVILY_KEY");
        if (string.IsNullOrWhiteSpace(serperKey) && string.IsNullOrWhiteSpace(tavilyKey))
            return ToolResult.Failure(Slug,
                "SERPER_KEY/TAVILY_KEY yapılandırılmamış — gerçek ürün araması yapılamıyor. (Fiyat/link uydurma.)");

        var query = qEl.GetString()!.Trim();

        var n = DefaultResults;
        if (args.TryGetProperty("max_results", out var nEl) && nEl.ValueKind == JsonValueKind.Number
            && nEl.TryGetInt32(out var nn)) n = Math.Clamp(nn, 1, MaxResults);

        var gl = args.TryGetProperty("country", out var glEl) && glEl.ValueKind == JsonValueKind.String
            ? glEl.GetString()! : "tr";
        var hl = args.TryGetProperty("language", out var hlEl) && hlEl.ValueKind == JsonValueKind.String
            ? hlEl.GetString()! : "tr";

        var errors = new List<string>();
        List<object>? results = null;
        var sourceApi = "";

        // 1) Serper.dev Shopping (fiyatlı sonuç)
        if (!string.IsNullOrWhiteSpace(serperKey))
        {
            try
            {
                results = await SerperShoppingAsync(serperKey!, query, n, gl, hl, ct);
                if (results.Count > 0) sourceApi = "serper-shopping";
                else errors.Add("serper-shopping: 0 sonuç (genel sorgu olabilir)");
            }
            catch (Exception ex) { errors.Add($"serper-shopping: {ex.Message}"); }
        }

        // 2) Serper.dev Web (gerçek URL, fiyatsız) — shopping boşsa
        if ((results is null || results.Count == 0) && !string.IsNullOrWhiteSpace(serperKey))
        {
            try
            {
                results = await SerperWebAsync(serperKey!, query, n, gl, hl, ct);
                if (results.Count > 0) sourceApi = "serper-web";
            }
            catch (Exception ex) { errors.Add($"serper-web: {ex.Message}"); }
        }

        // 3) Tavily (her ikisi de yok/boş/başarısızsa)
        if ((results is null || results.Count == 0) && !string.IsNullOrWhiteSpace(tavilyKey))
        {
            try
            {
                results = await TavilyAsync(tavilyKey!, query, n, ct);
                if (results.Count > 0) sourceApi = "tavily";
            }
            catch (Exception ex) { errors.Add($"tavily: {ex.Message}"); }
        }

        if (results is null || results.Count == 0)
        {
            Console.Error.WriteLine($"[product_search] '{query}' → 0 sonuç. {string.Join("; ", errors)}");
            return ToolResult.Failure(Slug,
                $"'{query}' için sonuç bulunamadı." + (errors.Count > 0 ? " (" + string.Join("; ", errors) + ")" : ""));
        }

        // Teşhis: hangi backend cevapladı + kaç sonuç (Actions logunda görünür).
        Console.Error.WriteLine($"[product_search] '{query}' → {results.Count} sonuç (source={sourceApi})"
            + (errors.Count > 0 ? $" [denenenler: {string.Join("; ", errors)}]" : ""));

        var output = JsonSerializer.SerializeToElement(new
        {
            query,
            source_api = sourceApi,
            count      = results.Count,
            results,
        });

        return ToolResult.Success(Slug, output);
    }

    // ── Serper.dev Shopping (fiyatlı) ─────────────────────────────────────────

    private static async Task<List<object>> SerperShoppingAsync(
        string key, string query, int n, string gl, string hl, CancellationToken ct)
    {
        var body = await SerperPostAsync("https://google.serper.dev/shopping", key, query, n, gl, hl, ct);

        var list = new List<object>();
        using var doc = JsonDocument.Parse(body);
        if (doc.RootElement.TryGetProperty("shopping", out var shopping) && shopping.ValueKind == JsonValueKind.Array)
        {
            foreach (var r in shopping.EnumerateArray())
            {
                if (list.Count >= n) break;
                var link = Str(r, "link");
                if (link is null) continue;
                list.Add(new
                {
                    title       = Str(r, "title"),
                    price       = Str(r, "price"),
                    price_value = (double?)null,
                    source      = Str(r, "source"),
                    link,
                });
            }
        }
        return list;
    }

    // ── Serper.dev Web (gerçek URL, fiyatsız) ─────────────────────────────────

    private static async Task<List<object>> SerperWebAsync(
        string key, string query, int n, string gl, string hl, CancellationToken ct)
    {
        var body = await SerperPostAsync("https://google.serper.dev/search", key, query, n, gl, hl, ct);

        var list = new List<object>();
        using var doc = JsonDocument.Parse(body);
        if (doc.RootElement.TryGetProperty("organic", out var organic) && organic.ValueKind == JsonValueKind.Array)
        {
            foreach (var r in organic.EnumerateArray())
            {
                if (list.Count >= n) break;
                var link = Str(r, "link");
                if (link is null) continue;
                list.Add(new
                {
                    title       = Str(r, "title"),
                    price       = (string?)null,
                    price_value = (double?)null,
                    source      = DomainOf(link),
                    link,
                });
            }
        }
        return list;
    }

    private static async Task<string> SerperPostAsync(
        string endpoint, string key, string query, int n, string gl, string hl, CancellationToken ct)
    {
        var payload = JsonSerializer.Serialize(new { q = query, gl, hl, num = n });

        using var cts = CancellationTokenSource.CreateLinkedTokenSource(ct);
        cts.CancelAfter(TimeSpan.FromSeconds(25));
        var resp = await HttpRetry.SendAsync(HttpClientPool.Shared, () =>
        {
            var req = new HttpRequestMessage(HttpMethod.Post, endpoint)
            {
                Content = new StringContent(payload, Encoding.UTF8, "application/json")
            };
            req.Headers.TryAddWithoutValidation("X-API-KEY", key);
            return req;
        }, cts.Token);

        var body = await resp.Content.ReadAsStringAsync(cts.Token);
        if (!resp.IsSuccessStatusCode)
            throw new InvalidOperationException($"HTTP {(int)resp.StatusCode}: {Trunc(body, 160)}");
        return body;
    }

    // ── Tavily web search (fallback) ──────────────────────────────────────────

    private static async Task<List<object>> TavilyAsync(string key, string query, int n, CancellationToken ct)
    {
        var payload = JsonSerializer.Serialize(new
        {
            api_key      = key,
            query,
            max_results  = n,
            search_depth = "basic",
            include_answer = false,
        });

        using var cts = CancellationTokenSource.CreateLinkedTokenSource(ct);
        cts.CancelAfter(TimeSpan.FromSeconds(25));
        var resp = await HttpRetry.SendAsync(HttpClientPool.Shared, () =>
        {
            var req = new HttpRequestMessage(HttpMethod.Post, "https://api.tavily.com/search")
            {
                Content = new StringContent(payload, Encoding.UTF8, "application/json")
            };
            req.Headers.TryAddWithoutValidation("Authorization", $"Bearer {key}");
            return req;
        }, cts.Token);

        var body = await resp.Content.ReadAsStringAsync(cts.Token);
        if (!resp.IsSuccessStatusCode)
            throw new InvalidOperationException($"HTTP {(int)resp.StatusCode}: {Trunc(body, 160)}");

        var list = new List<object>();
        using var doc = JsonDocument.Parse(body);
        if (doc.RootElement.TryGetProperty("results", out var arr) && arr.ValueKind == JsonValueKind.Array)
        {
            foreach (var r in arr.EnumerateArray())
            {
                if (list.Count >= n) break;
                var link = Str(r, "url");
                if (link is null) continue;
                list.Add(new
                {
                    title       = Str(r, "title"),
                    price       = (string?)null,        // Tavily fiyat döndürmez; agent sayfadan/araştırmadan çıkarır
                    price_value = (double?)null,
                    source      = DomainOf(link),
                    link,
                });
            }
        }
        return list;
    }

    // ── Yardımcılar ──────────────────────────────────────────────────────────

    private static string? DomainOf(string url)
        => Uri.TryCreate(url, UriKind.Absolute, out var u) ? u.Host : null;

    private static string? Str(JsonElement obj, string name)
        => obj.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() : null;

    private static string Trunc(string s, int max) => s.Length <= max ? s : s[..max];

    private static JsonElement Schema(string json)
    {
        using var doc = JsonDocument.Parse(json);
        return doc.RootElement.Clone();
    }
}
