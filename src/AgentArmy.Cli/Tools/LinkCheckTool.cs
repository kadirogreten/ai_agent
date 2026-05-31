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
            "total": { "type": "integer" },
            "ok":    { "type": "integer" },
            "dead":  { "type": "integer" }
          }
        },
        "results": {
          "type": "array",
          "items": {
            "type": "object",
            "properties": {
              "url":    { "type": "string" },
              "ok":     { "type": "boolean" },
              "status": { "type": "integer" },
              "error":  { "type": "string" }
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
        Description  = "Verilen URL listesini HEAD ile kontrol eder; her URL için 200/404/error döner. Substance verifier zincirinin temel parçası — uydurma kaynakları tespit eder.",
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

        var ok   = results.Count(r => r.Ok);
        var dead = results.Length - ok;

        var output = JsonSerializer.SerializeToElement(new
        {
            summary = new { total = results.Length, ok, dead },
            results = results.Select(r => new
            {
                url    = r.Url,
                ok     = r.Ok,
                status = r.Status,
                error  = r.Error,
            }),
        });

        return ToolResult.Success(Slug, output);
    }

    private static async Task<LinkResult> CheckOneAsync(string url, int timeoutSec, SemaphoreSlim sem, CancellationToken ct)
    {
        await sem.WaitAsync(ct);
        try
        {
            if (!Uri.TryCreate(url, UriKind.Absolute, out var uri)
                || (uri.Scheme != Uri.UriSchemeHttp && uri.Scheme != Uri.UriSchemeHttps))
            {
                return new LinkResult(url, false, 0, "Geçersiz URL (http/https değil).");
            }

            using var cts = CancellationTokenSource.CreateLinkedTokenSource(ct);
            cts.CancelAfter(TimeSpan.FromSeconds(timeoutSec));

            try
            {
                var headReq = new HttpRequestMessage(HttpMethod.Head, uri);
                headReq.Headers.TryAddWithoutValidation("User-Agent", "AgentArmy/0.1 (+link_check)");
                using var headResp = await HttpClientPool.Shared.SendAsync(headReq, cts.Token);

                // 405 Method Not Allowed (bazı sunucular HEAD desteklemez) → GET ile dene.
                if ((int)headResp.StatusCode == 405)
                {
                    var getReq = new HttpRequestMessage(HttpMethod.Get, uri);
                    getReq.Headers.TryAddWithoutValidation("User-Agent", "AgentArmy/0.1 (+link_check)");
                    getReq.Headers.TryAddWithoutValidation("Range", "bytes=0-1023");
                    using var getResp = await HttpClientPool.Shared.SendAsync(getReq, HttpCompletionOption.ResponseHeadersRead, cts.Token);
                    var okGet = (int)getResp.StatusCode is >= 200 and < 400;
                    return new LinkResult(url, okGet, (int)getResp.StatusCode, okGet ? null : getResp.ReasonPhrase);
                }

                var ok = (int)headResp.StatusCode is >= 200 and < 400;
                return new LinkResult(url, ok, (int)headResp.StatusCode, ok ? null : headResp.ReasonPhrase);
            }
            catch (OperationCanceledException) when (!ct.IsCancellationRequested)
            {
                return new LinkResult(url, false, 0, $"Timeout ({timeoutSec}sn).");
            }
            catch (Exception ex)
            {
                return new LinkResult(url, false, 0, ex.Message);
            }
        }
        finally
        {
            sem.Release();
        }
    }

    private sealed record LinkResult(string Url, bool Ok, int Status, string? Error);

    private static JsonElement Schema(string json)
    {
        using var doc = JsonDocument.Parse(json);
        return doc.RootElement.Clone();
    }
}
