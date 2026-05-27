using System.Text.Json;

namespace AgentArmy.Cli;

/// <summary>
/// Risk kapısı: R2/R3 seviyeli adımları çalıştırmadan önce approval_queue tablosuna
/// kayıt atar ve karar verilene kadar bekler. R0/R1 anında geçer.
///
/// Polling pattern; production'da LISTEN/NOTIFY veya webhook'a geçilebilir.
/// </summary>
public static class RiskGate
{
    private static readonly TimeSpan PollInterval     = TimeSpan.FromSeconds(15);
    private static readonly TimeSpan MaxWait          = TimeSpan.FromHours(4);
    private const string EnvOwnerKey = "RUN_OWNER_USER_ID";

    public sealed record GateOutcome(bool Approved, string? Reason, string? ApprovalQueueId);

    /// <summary>
    /// Tool-call granülaritesinde onay kapısı (Faz A — PR5). <see cref="GateAsync"/>'i araç
    /// çağrısı bağlamıyla sarmalar: action_summary = "tool:&lt;slug&gt;". R0/R1 oto-onay;
    /// R2/R3 approval_queue'ya yazıp bekler.
    /// </summary>
    public static Task<GateOutcome> GateForToolAsync(
        SupabaseWriter? db,
        string risk,
        string runId,
        string agentId,
        string toolSlug,
        object? args,
        CancellationToken ct)
        => GateAsync(db, risk, runId, agentId,
            actionSummary: $"tool:{toolSlug}",
            actionDetail: new { tool = toolSlug, args }, ct);

    /// <summary>
    /// Verilen risk seviyesi için onay kapısını çalıştırır.
    /// R0/R1: anında approved döner.
    /// R2/R3: approval_queue'ya yazar, kararı bekler (max 4 saat).
    /// DB yoksa veya owner_user_id env'de yoksa: warning + approved (dev-mode bypass).
    /// </summary>
    public static async Task<GateOutcome> GateAsync(
        SupabaseWriter? db,
        string risk,
        string runId,
        string agentId,
        string actionSummary,
        object? actionDetail,
        CancellationToken ct)
    {
        var normalized = (risk ?? string.Empty).Trim().ToUpperInvariant();
        if (normalized != "R2" && normalized != "R3")
            return new GateOutcome(true, "auto-approved (R0/R1)", null);

        if (db is null)
        {
            Console.Error.WriteLine($"[RiskGate] WARNING: {normalized} ama DB yok — dev-mode bypass.");
            return new GateOutcome(true, "no-db bypass (development)", null);
        }

        var ownerId = Environment.GetEnvironmentVariable(EnvOwnerKey);
        if (string.IsNullOrWhiteSpace(ownerId))
        {
            Console.Error.WriteLine($"[RiskGate] WARNING: {normalized} ama {EnvOwnerKey} yok — dev-mode bypass.");
            return new GateOutcome(true, "no-owner bypass (development)", null);
        }

        // approval_queue'ya kayıt at — id Supabase tarafında oluşur (gen_random_uuid).
        // SupabaseWriter Prefer:return=minimal kullandığı için id'yi geri alamayız;
        // bu yüzden kendi UUID'mizi üretip insert ediyoruz.
        var queueId = Guid.NewGuid().ToString();
        Console.WriteLine($"[RiskGate] {normalized} risk — approval_queue'ya yazılıyor (id={queueId})...");

        await db.InsertAsync("approval_queue", new
        {
            id              = queueId,
            owner_user_id   = ownerId,
            run_request_id  = (string?)null,
            step_index      = 0,
            step_name       = runId,
            agent_code      = agentId,
            risk_level      = normalized,
            action_summary  = actionSummary,
            action_detail   = actionDetail,
            status          = "pending"
        }, ct);

        var deadline = DateTimeOffset.UtcNow.Add(MaxWait);
        var pollCount = 0;

        while (DateTimeOffset.UtcNow < deadline)
        {
            ct.ThrowIfCancellationRequested();
            await Task.Delay(PollInterval, ct);
            pollCount++;

            var q = $"id=eq.{Uri.EscapeDataString(queueId)}&select=status,reviewer_note&limit=1";
            var json = await db.SelectAsync("approval_queue", q, ct);

            if (json.ValueKind == JsonValueKind.Array && json.GetArrayLength() > 0)
            {
                var row = json[0];
                var status = row.TryGetProperty("status", out var s) && s.ValueKind == JsonValueKind.String
                    ? s.GetString() ?? "pending" : "pending";

                if (status == "approved")
                {
                    Console.WriteLine($"[RiskGate] {normalized} onaylandı (poll #{pollCount}).");
                    return new GateOutcome(true, "approved", queueId);
                }
                if (status == "rejected")
                {
                    var note = row.TryGetProperty("reviewer_note", out var n) && n.ValueKind == JsonValueKind.String
                        ? n.GetString() : null;
                    Console.WriteLine($"[RiskGate] {normalized} REDDEDİLDİ: {note ?? "(not yok)"}");
                    return new GateOutcome(false, $"rejected: {note ?? "no note"}", queueId);
                }
                if (status == "expired")
                {
                    return new GateOutcome(false, "expired by reviewer", queueId);
                }
            }

            if (pollCount % 20 == 0)
                Console.WriteLine($"[RiskGate] hala beklemede ({pollCount * PollInterval.TotalSeconds:0}sn)...");
        }

        Console.Error.WriteLine($"[RiskGate] TIMEOUT — {MaxWait.TotalHours} saat içinde karar verilmedi.");
        return new GateOutcome(false, $"timeout after {MaxWait.TotalHours}h", queueId);
    }
}
