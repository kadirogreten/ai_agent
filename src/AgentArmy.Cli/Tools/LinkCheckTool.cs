using System.Text.Json;

namespace AgentArmy.Cli;

// Faz B — Substance verifier: link_check.
// Tasarım: dogfood W1 review — Verifier rubric'i URL "var mı" diye bakıyor ama
// URL'lerin gerçekten yaşadığını test etmiyordu. Writer kaskadı uydurma URL'ler
// ekleyerek metrik'i oyalıyordu. Bu araç: verilen URL listesini HEAD ile kontrol
// eder, dead/timeout linkleri tespit ettirir.
//
// side_effect=read (yan etki yok, geri-alınabilir), min_risk=R0.
// Paralelizm: aynı anda en fazla 5 istek (SemaphoreSlim). Per-URL timeout 5sn.
// HEAD desteklemeyen sunucular için GET fallback (Range header ile küçük gövde).

public sealed class LinkCheckTool : ITool
{
    public string Slug => "link_check";

    private const int MaxParallel    = 5;
    private const int MaxUrls        = 30;
    private const int DefaultTimeout = 5;

    private static readonly JsonElement InputSchemaJson = Schema("""
    {
      "type": "object",
      "required": ["urls"],
      "properties": {
        "urls": {
          "type": "array",
          "items": { "type": "string" },
          "description": "Doğrulanacak URL listesi (en fazla 30)",
          "maxItems": 30
        },
        "timeout_seconds": {
          "type": "integer", "default": 5, "minimum": 1, "maximum": 15,
          "description": "URL başına timeout"
        }
      }
    }
    """);

    private static readonly JsonElement OutputSchemaJson = Schema("""
    {
      "type": "object",
      "properties": {
        "summary": {
          "type": "object",
          "properties": {
            "total":   { "type": "integer" },
            "alive":   { "type": "integer" },
            "blocked": { "type": "integer" },
            "dead":    { "type": "integer" }
          }
        },
        "results": {
          "type": "array",
          "items": {
            "type": "object",
            "properties": {
              "url":     { "type": "string" },
              "verdict": { "type": "string", "description": "alive | blocked | dead" },
              "status":  { "type": "integer" },
              "note":    { "type": "string" }
            }
          }
        }
      }
    }
    """);

    public ToolDescriptor Descriptor => new()
    {
        Slug         = Slug,
        Name         = "Link Doğrulama",
        Description  = "Verilen URL listesini kontrol eder; her URL için verdict döner: alive (200/3xx), blocked (403/429/timeout — anti-bot, link MUHTEMELEN geçerli, ÖLÜ DEĞİL), dead (404/410/DNS). Yalnız 'dead' uydurma/geçersiz sayılmalıdır; 'blocked' bot korumasıdır, FAIL gerekçesi değildir.",
        Category     = "utility",
        SideEffect   = ToolSideEffect.Read,
        Reversible   = true,
        MinRisk      = "R0",
        InputSchema  = InputSchemaJson,
        OutputSchema = OutputSchemaJson,
    };

    public async Task<ToolResult> InvokeAsync(JsonElement args, RunContext ctx, CancellationToken ct)
    {
        if (args.ValueKind != JsonValueKind.Object
            || !args.TryGetProperty("urls", out var urlsEl)
            || urlsEl.ValueKind != JsonValueKind.Array)
        {
            return ToolResult.Failure(Slug, "Zorunlu 'urls' argümanı (string dizisi) eksik.");
        }

        var urls = new List<string>();
        foreach (var u in urlsEl.EnumerateArray())
        {
            if (u.ValueKind != JsonValueKind.String) continue;
            var s = u.GetString();
            if (!string.IsNullOrWhiteSpace(s)) urls.Add(s.Trim());
        }
        if (urls.Count == 0)
            return ToolResult.Failure(Slug, "'urls' boş.");
        if (urls.Count > MaxUrls)
            urls = urls.Take(MaxUrls).ToList();

        var timeoutSec = DefaultTimeout;
        if (args.TryGetProperty("timeout_seconds", out var tEl)
            && tEl.ValueKind == JsonValueKind.Number
            && tEl.TryGetInt32(out var t))
        {
            timeoutSec = Math.Clamp(t, 1, 15);
        }

        var sem     = new SemaphoreSlim(MaxParallel, MaxParallel);
        var tasks   = urls.Select(u => CheckOneAsync(u, timeoutSec, sem, ct)).ToArray();
        var results = await Task.WhenAll(tasks);

        var alive   = results.Count(r => r.Verdict == "alive");
        var blocked = results.Count(r => r.Verdict == "blocked");
        var dead    = results.Count(r => r.Verdict == "dead");

        var output = JsonSerializer.SerializeToElement(new
        {
            summary = new { total = results.Length, alive, blocked, dead },
            results = results.Select(r => new
            {
                url     = r.Url,
                verdict = r.Verdict,
                status  = r.Status,
                note    = r.Note,
            }),
        });

        return ToolResult.Success(Slug, output);
    }

    // 403/429/timeout = anti-bot bloğu (link muhtemelen geçerli); yalnız 404/410/DNS = dead.
    private static (string Verdict, string? Note) Classify(int status) => status switch
    {
        >= 200 and < 400 => ("alive", null),
        401 or 403 or 429 => ("blocked", $"HTTP {status} — anti-bot/auth bloğu; link muhtemelen geçerli (ölü değil)"),
        404 or 410        => ("dead", $"HTTP {status} — sayfa yok"),
        >= 500            => ("blocked", $"HTTP {status} — sunucu hatası, belirsiz"),
        _                 => ("blocked", $"HTTP {status} — belirsiz"),
    };

    private static async Task<LinkResult> CheckOneAsync(string url, int timeoutSec, SemaphoreSlim sem, CancellationToken ct)
    {
        await sem.WaitAsync(ct);
        try
        {
            if (!Uri.TryCreate(url, UriKind.Absolute, out var uri)
                || (uri.Scheme != Uri.UriSchemeHttp && uri.Scheme != Uri.UriSchemeHttps))
            {
                return new LinkResult(url, "dead", 0, "Geçersiz URL (http/https değil).");
            }

            using var cts = CancellationTokenSource.CreateLinkedTokenSource(ct);
            cts.CancelAfter(TimeSpan.FromSeconds(timeoutSec));

            try
            {
                var headReq = new HttpRequestMessage(HttpMethod.Head, uri);
                headReq.Headers.TryAddWithoutValidation("User-Agent", "AgentArmy/0.1 (+link_check)");
                using var headResp = await HttpClientPool.Shared.SendAsync(headReq, cts.Token);

                var status = (int)headResp.StatusCode;
                // 405 Method Not Allowed (bazı sunucular HEAD desteklemez) → GET ile dene.
                if (status == 405)
                {
                    var getReq = new HttpRequestMessage(HttpMethod.Get, uri);
                    getReq.Headers.TryAddWithoutValidation("User-Agent", "AgentArmy/0.1 (+link_check)");
                    getReq.Headers.TryAddWithoutValidation("Range", "bytes=0-1023");
                    using var getResp = await HttpClientPool.Shared.SendAsync(getReq, HttpCompletionOption.ResponseHeadersRead, cts.Token);
                    status = (int)getResp.StatusCode;
                }

                var (verdict, note) = Classify(status);
                return new LinkResult(url, verdict, status, note);
            }
            catch (OperationCanceledException) when (!ct.IsCancellationRequested)
            {
                // Timeout — ölü değil, belirsiz/bloklu say (siteler botu yavaşlatabilir).
                return new LinkResult(url, "blocked", 0, $"Timeout ({timeoutSec}sn) — belirsiz, ölü sayma");
            }
            catch (HttpRequestException ex)
            {
                // DNS/bağlantı hatası — gerçekten ulaşılamıyor.
                return new LinkResult(url, "dead", 0, $"Bağlantı hatası: {ex.Message}");
            }
            catch (Exception ex)
            {
                return new LinkResult(url, "blocked", 0, $"Belirsiz: {ex.Message}");
            }
        }
        finally
        {
            sem.Release();
        }
    }

    private sealed record LinkResult(string Url, string Verdict, int Status, string? Note);

    private static JsonElement Schema(string json)
    {
        using var doc = JsonDocument.Parse(json);
        return doc.RootElement.Clone();
    }
}
