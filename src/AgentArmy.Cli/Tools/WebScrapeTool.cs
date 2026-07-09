using System.Net;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace AgentArmy.Cli;

// Faz A — Tool Invocation: web_scrape (salt-okunur read aracı, PR2).
// Tasarım: docs/faz-a-tool-invocation-tasarim.md (§4)
// Verilen URL'yi BCL HttpClient ile çeker, HTML'i kaba biçimde düz metne indirger.
// Ek bağımlılık yok: HttpClientPool + HttpRetry kullanır.

public sealed class WebScrapeTool : ITool
{
    public string Slug => "web_scrape";

    private const int MaxChars = 20_000;
    private const int DefaultTimeoutSeconds = 15;

    private static readonly JsonElement InputSchemaJson = Schema("""
    {
      "type": "object",
      "required": ["url"],
      "properties": {
        "url": { "type": "string", "description": "Çekilecek http/https adresi" },
        "timeout_seconds": { "type": "integer", "default": 15, "minimum": 1, "maximum": 60 }
      }
    }
    """);

    private static readonly JsonElement OutputSchemaJson = Schema("""
    {
      "type": "object",
      "properties": {
        "url": { "type": "string" },
        "status": { "type": "integer" },
        "length": { "type": "integer" },
        "text": { "type": "string" }
      }
    }
    """);

    public ToolDescriptor Descriptor => new()
    {
        Slug         = Slug,
        Name         = "Web İçerik Çekme",
        Description  = "Verilen URL'den sayfa içeriğini okur ve düz metin olarak döner.",
        Category     = "search",
        SideEffect   = ToolSideEffect.Read,
        Reversible   = true,
        MinRisk          = "R0",
        UntrustedSource  = true,
        InputSchema      = InputSchemaJson,
        OutputSchema     = OutputSchemaJson,
    };

    public async Task<ToolResult> InvokeAsync(JsonElement args, RunContext ctx, CancellationToken ct)
    {
        // url zorunlu
        if (args.ValueKind != JsonValueKind.Object ||
            !args.TryGetProperty("url", out var urlEl) ||
            urlEl.ValueKind != JsonValueKind.String)
        {
            return ToolResult.Failure(Slug, "Zorunlu 'url' argümanı (string) eksik.");
        }

        var url = urlEl.GetString() ?? string.Empty;
        if (!Uri.TryCreate(url, UriKind.Absolute, out var uri) ||
            (uri.Scheme != Uri.UriSchemeHttp && uri.Scheme != Uri.UriSchemeHttps))
        {
            return ToolResult.Failure(Slug, $"Geçersiz URL (yalnız http/https): '{url}'");
        }

        var timeoutSec = DefaultTimeoutSeconds;
        if (args.TryGetProperty("timeout_seconds", out var tEl) && tEl.ValueKind == JsonValueKind.Number
            && tEl.TryGetInt32(out var t))
        {
            timeoutSec = Math.Clamp(t, 1, 60);
        }

        using var cts = CancellationTokenSource.CreateLinkedTokenSource(ct);
        cts.CancelAfter(TimeSpan.FromSeconds(timeoutSec));

        HttpResponseMessage resp;
        string body;
        try
        {
            resp = await HttpRetry.SendAsync(
                HttpClientPool.Shared,
                () =>
                {
                    var req = new HttpRequestMessage(HttpMethod.Get, uri);
                    req.Headers.TryAddWithoutValidation("User-Agent", "AgentArmy/0.1 (+web_scrape)");
                    req.Headers.TryAddWithoutValidation("Accept", "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.8");
                    return req;
                },
                cts.Token);

            body = await resp.Content.ReadAsStringAsync(cts.Token);
        }
        catch (OperationCanceledException) when (!ct.IsCancellationRequested)
        {
            return ToolResult.Failure(Slug, $"Zaman aşımı ({timeoutSec}s).");
        }
        catch (Exception ex)
        {
            return ToolResult.Failure(Slug, $"İstek hatası: {ex.Message}");
        }

        if (!resp.IsSuccessStatusCode)
            return ToolResult.Failure(Slug, $"HTTP {(int)resp.StatusCode} — {uri}");

        var text = HtmlToText(body);
        var truncated = text.Length > MaxChars;
        if (truncated) text = text[..MaxChars];

        var output = JsonSerializer.SerializeToElement(new
        {
            url       = uri.ToString(),
            status    = (int)resp.StatusCode,
            length    = text.Length,
            truncated,
            text,
        });

        return ToolResult.Success(Slug, output);
    }

    // ── Yardımcılar ──────────────────────────────────────────────────────────

    private static string HtmlToText(string html)
    {
        if (string.IsNullOrEmpty(html)) return string.Empty;

        var s = Regex.Replace(html, "<script[\\s\\S]*?</script>", " ", RegexOptions.IgnoreCase);
        s = Regex.Replace(s, "<style[\\s\\S]*?</style>", " ", RegexOptions.IgnoreCase);
        s = Regex.Replace(s, "<!--[\\s\\S]*?-->", " ");
        s = Regex.Replace(s, "<[^>]+>", " ");
        s = WebUtility.HtmlDecode(s);
        s = Regex.Replace(s, "\\s+", " ").Trim();
        return s;
    }

    private static JsonElement Schema(string json)
    {
        using var doc = JsonDocument.Parse(json);
        return doc.RootElement.Clone();
    }
}
