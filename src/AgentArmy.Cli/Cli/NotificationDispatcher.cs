using System.Net;
using System.Net.Http.Json;
using System.Text.Json;

namespace AgentArmy.Cli;

// Güvenlik kilidi 3 — Bildirim.
// approval_queue'ya yeni kayıt düştüğünde aktif kanalları bilgilendirir.
// Slack webhook (HTTP POST) + Resend e-posta (RESEND_API_KEY env).
//
// Güvenlik notu: notification_channels.target hassas veridir (webhook URL / e-posta).
// Bu sınıf audit log'a veya herhangi bir log satırına target yazmaz.
//
// Kapsam notu: Bu dispatcher yalnız CLI RiskGate insert yolunu kapsar.
// Run-seviyesi R2 onayları (worker/gate_run_for_approval) PR3'te eklenecek.

public static class NotificationDispatcher
{
    private static readonly HttpClient _http = new(HttpClientPool.SharedHandler, disposeHandler: false)
    {
        Timeout = TimeSpan.FromSeconds(10)
    };

    /// <summary>
    /// Sahibin aktif bildirim kanallarını okur ve approval_queue kaydını bildirir.
    /// Kanal yoksa sessiz geçer. Hata olursa log atar; gate'i düşürmez.
    /// </summary>
    public static async Task NotifyApprovalQueueAsync(
        SupabaseWriter db,
        string ownerId,
        string queueId,
        string actionSummary,
        string risk,
        CancellationToken ct)
    {
        JsonElement channels;
        try
        {
            channels = await db.SelectAsync(
                "notification_channels",
                $"owner_user_id=eq.{Uri.EscapeDataString(ownerId)}&enabled=eq.true&select=type,target,label",
                ct);
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine($"[NotificationDispatcher] kanal listesi okunamadı: {ex.Message}");
            return;
        }

        if (channels.ValueKind != JsonValueKind.Array || channels.GetArrayLength() == 0)
            return;

        var message = $"[AgentArmy] {risk} onay bekleniyor: {actionSummary} (id={queueId})";

        foreach (var ch in channels.EnumerateArray())
        {
            var type   = ch.TryGetProperty("type",   out var tEl) ? tEl.GetString() : null;
            var target = ch.TryGetProperty("target", out var dEl) ? dEl.GetString() : null;
            var label  = ch.TryGetProperty("label",  out var lEl) ? lEl.GetString() : null;

            if (string.IsNullOrWhiteSpace(type) || string.IsNullOrWhiteSpace(target)) continue;

            try
            {
                if (type == "slack_webhook")
                    await SendSlackAsync(target, message, ct);
                else if (type == "email")
                    await SendEmailAsync(target, label, message, actionSummary, risk, queueId, ct);
            }
            catch (OperationCanceledException)
            {
                throw;
            }
            catch (Exception ex)
            {
                // target hassas — sadece type ve label logla
                Console.Error.WriteLine($"[NotificationDispatcher] {type} ({label ?? "?"}) gönderim hatası: {ex.Message}");
            }
        }
    }

    private static async Task SendSlackAsync(string webhookUrl, string message, CancellationToken ct)
    {
        using var resp = await _http.PostAsJsonAsync(
            webhookUrl,
            new { text = message },
            ct);

        if (!resp.IsSuccessStatusCode)
        {
            var body = await resp.Content.ReadAsStringAsync(ct);
            Console.Error.WriteLine($"[NotificationDispatcher] Slack yanıtı: {(int)resp.StatusCode} {body[..Math.Min(100, body.Length)]}");
        }
    }

    private static async Task SendEmailAsync(
        string toEmail, string? label, string message,
        string actionSummary, string risk, string queueId,
        CancellationToken ct)
    {
        var apiKey = Environment.GetEnvironmentVariable("RESEND_API_KEY");
        if (string.IsNullOrWhiteSpace(apiKey))
        {
            Console.Error.WriteLine("[NotificationDispatcher] RESEND_API_KEY tanımlı değil; e-posta atlanıyor.");
            return;
        }

        var fromAddress = Environment.GetEnvironmentVariable("RESEND_FROM_EMAIL") ?? "noreply@agentarmy.app";

        var req = new HttpRequestMessage(HttpMethod.Post, "https://api.resend.com/emails");
        req.Headers.Add("Authorization", $"Bearer {apiKey}");
        req.Content = JsonContent.Create(new
        {
            from    = fromAddress,
            to      = new[] { toEmail },
            subject = $"[AgentArmy] {risk} onay bekleniyor",
            text    = message,
            html    = $"<p><strong>{risk} onay bekleniyor</strong></p>" +
                      $"<p>İşlem: {WebUtility.HtmlEncode(actionSummary)}</p>" +
                      $"<p>Kuyruk ID: <code>{queueId}</code></p>",
        });

        using var resp = await _http.SendAsync(req, ct);
        if (!resp.IsSuccessStatusCode)
        {
            var body = await resp.Content.ReadAsStringAsync(ct);
            Console.Error.WriteLine($"[NotificationDispatcher] Resend yanıtı: {(int)resp.StatusCode} {body[..Math.Min(100, body.Length)]}");
        }
    }
}
