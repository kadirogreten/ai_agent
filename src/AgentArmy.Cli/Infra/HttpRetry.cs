using System.Net.Http.Headers;

namespace AgentArmy.Cli;

/// <summary>
/// HTTP retry yardımcısı — 429 (rate limit), 5xx ve geçici ağ hatalarında
/// exponential backoff + jitter ile yeniden dener. Retry-After header'ı varsa
/// onu kullanır. 4xx (429 dışında) geri denenmez.
/// </summary>
public static class HttpRetry
{
    private static readonly Random _jitter = new();

    /// <summary>
    /// Verilen request factory'siyle istek gönderir; başarısızsa retry yapar.
    /// Factory her denemede yeni HttpRequestMessage üretir (HttpRequestMessage
    /// tek seferlik kullanılır).
    /// </summary>
    public static async Task<HttpResponseMessage> SendAsync(
        HttpClient http,
        Func<HttpRequestMessage> requestFactory,
        CancellationToken ct,
        int maxAttempts = 3)
    {
        Exception? lastEx = null;
        HttpResponseMessage? lastResp = null;

        for (int attempt = 1; attempt <= maxAttempts; attempt++)
        {
            try
            {
                var req  = requestFactory();
                var resp = await http.SendAsync(req, ct);

                if (resp.IsSuccessStatusCode) return resp;

                var status = (int)resp.StatusCode;

                // 4xx (429 hariç) — kalıcı hata, retry yapma.
                if (status >= 400 && status < 500 && status != 429)
                    return resp;

                lastResp = resp;
                if (attempt == maxAttempts) return resp;

                var delay = ComputeDelay(attempt, resp.Headers);
                Console.Error.WriteLine($"[HttpRetry] {status} → {attempt}/{maxAttempts}, {delay.TotalMilliseconds:0}ms sonra tekrar");
                await Task.Delay(delay, ct);
            }
            catch (HttpRequestException ex) when (attempt < maxAttempts)
            {
                lastEx = ex;
                var delay = ComputeDelay(attempt, headers: null);
                Console.Error.WriteLine($"[HttpRetry] network hata {attempt}/{maxAttempts}: {ex.Message}; {delay.TotalMilliseconds:0}ms sonra tekrar");
                await Task.Delay(delay, ct);
            }
            catch (TaskCanceledException ex) when (attempt < maxAttempts && !ct.IsCancellationRequested)
            {
                // Server timeout (cancellation kullanıcıdan gelmedi).
                lastEx = ex;
                var delay = ComputeDelay(attempt, headers: null);
                Console.Error.WriteLine($"[HttpRetry] timeout {attempt}/{maxAttempts}; {delay.TotalMilliseconds:0}ms sonra tekrar");
                await Task.Delay(delay, ct);
            }
        }

        if (lastResp is not null) return lastResp;
        throw lastEx ?? new InvalidOperationException("Retry policy exhausted with no response or exception captured.");
    }

    private static TimeSpan ComputeDelay(int attempt, HttpResponseHeaders? headers)
    {
        // Retry-After header'ı varsa öncelikli olarak kullan.
        if (headers?.RetryAfter is not null)
        {
            if (headers.RetryAfter.Delta is { } delta && delta.TotalMilliseconds > 0)
                return delta > TimeSpan.FromMinutes(2) ? TimeSpan.FromMinutes(2) : delta;
            if (headers.RetryAfter.Date is { } date)
            {
                var ts = date - DateTimeOffset.UtcNow;
                if (ts.TotalMilliseconds > 0)
                    return ts > TimeSpan.FromMinutes(2) ? TimeSpan.FromMinutes(2) : ts;
            }
        }

        // Exponential backoff: 1s, 2s, 4s + 0-300ms jitter.
        var baseMs = Math.Pow(2, attempt - 1) * 1000;
        int jitterMs;
        lock (_jitter) { jitterMs = _jitter.Next(0, 300); }
        return TimeSpan.FromMilliseconds(baseMs + jitterMs);
    }
}
