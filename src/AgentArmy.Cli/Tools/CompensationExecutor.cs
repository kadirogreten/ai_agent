using System.Text.Json;

namespace AgentArmy.Cli;

// Compensation runtime — Faz B.
// Yol haritası: docs/operasyonel-ozerklik-yol-haritasi.md (Faz B)
//
// İki kullanım yolu:
//   1. CLI: compensate --invocationId <id>
//      → CompensateInvocationAsync: DB'den satır okur, idempotency guard uygular,
//        ICompensable.CompensateAsync çağırır, DB'yi günceller, audit_log'a yazar.
//   2. Orchestrator in-flight exception:
//      → CompensateExchangesAsync: in-memory ToolExchange listesinden token'ları alır,
//        DB güncellemesi olmadan (invocation id bilinmiyor) ICompensable çağırır.
//
// Null-DB toleransı (mevcut kodun deseniyle tutarlı):
//   ctx.Db == null ise DB adımları atlanır, geri-alma yine de denenir.

public sealed class CompensationExecutor
{
    private readonly IReadOnlyDictionary<string, ITool> _tools;

    public CompensationExecutor(IEnumerable<ITool> tools)
    {
        var map = new Dictionary<string, ITool>(StringComparer.OrdinalIgnoreCase);
        foreach (var t in tools) map[t.Slug] = t;
        _tools = map;
    }

    // ── Yol 1: CLI — DB'den oku, compensate et, güncelle ────────────────────

    /// <summary>
    /// Verilen invocation ID'yi DB'den okuyarak geri-alma uygular.
    /// Idempotency guard: status='succeeded', compensation_token NOT NULL,
    /// compensated_at IS NULL, side_effect IN ('write','external') koşulu aranır.
    /// </summary>
    public async Task<CompensationResult> CompensateInvocationAsync(
        string invocationId,
        SupabaseWriter? db,
        string? ownerId,
        CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(invocationId))
            return CompensationResult.Failure("invocationId boş olamaz.");

        // DB yoksa sadece uyar; geri-alma token'sız yapılamaz.
        if (db is null)
            return CompensationResult.Failure("DB bağlantısı yok; invocation okunamıyor.");

        // Satırı oku
        var rows = await db.SelectAsync(
            "tool_invocations",
            $"id=eq.{Uri.EscapeDataString(invocationId)}&select=id,tool_slug,compensation_token,status,compensated_at,side_effect",
            ct);

        if (rows.ValueKind != JsonValueKind.Array || rows.GetArrayLength() == 0)
            return CompensationResult.Failure($"Invocation bulunamadı: {invocationId}");

        var row = rows[0];

        // Idempotency guard
        var status          = row.TryGetProperty("status",             out var sEl) ? sEl.GetString() : null;
        var compToken       = row.TryGetProperty("compensation_token", out var tEl) ? tEl.GetString() : null;
        var compensatedAt   = row.TryGetProperty("compensated_at",     out var caEl) && caEl.ValueKind != JsonValueKind.Null
                              ? caEl.GetString() : null;
        var sideEffect      = row.TryGetProperty("side_effect",        out var seEl) ? seEl.GetString() : null;
        var slug            = row.TryGetProperty("tool_slug",          out var slEl) ? slEl.GetString() : null;

        if (status != "succeeded")
            return CompensationResult.Failure($"Geri-alma yalnız 'succeeded' kayıtlara uygulanır (mevcut: {status}).");

        if (string.IsNullOrWhiteSpace(compToken))
            return CompensationResult.Failure("compensation_token boş; geri-alma anahtarı yok.");

        if (sideEffect is not ("write" or "external"))
            return CompensationResult.Failure($"Yan etkisiz araç geri alınamaz (side_effect={sideEffect}).");

        if (!string.IsNullOrWhiteSpace(compensatedAt))
        {
            Console.Error.WriteLine($"[CompensationExecutor] no-op: {invocationId} zaten geri alındı ({compensatedAt}).");
            return CompensationResult.Success($"Zaten geri alınmış: {compensatedAt}");
        }

        // ICompensable aracı bul
        if (string.IsNullOrWhiteSpace(slug) || !_tools.TryGetValue(slug, out var tool))
            return CompensationResult.Failure($"Araç bulunamadı: '{slug}'");

        if (tool is not ICompensable compensable)
            return CompensationResult.Failure($"'{slug}' ICompensable değil.");

        // Geri-al
        var result = await compensable.CompensateAsync(compToken, db, ownerId, ct);

        // DB: compensated_at + compensation_status + status tek UPDATE'te (yarım kayıt kalmasın).
        // status='compensated' CHECK kısıtında destekleniyor (0027_tool_invocation.sql).
        var compStatus = result.Ok ? "succeeded" : "failed";
        await db.PatchAsync(
            "tool_invocations",
            $"id=eq.{Uri.EscapeDataString(invocationId)}",
            new { status = "compensated", compensated_at = DateTimeOffset.UtcNow, compensation_status = compStatus },
            ct);

        // Audit log
        var action   = result.Ok ? "tool.compensated" : "tool.compensation_failed";
        var severity = result.Ok ? "info" : "error";
        await db.CallRpcAsync("append_audit_log", new
        {
            p_owner_user_id = ownerId,
            p_actor_type    = "system",
            p_actor_id      = "compensation_executor",
            p_action        = action,
            p_resource_type = "tool",
            p_risk_level    = (string?)null,
            p_severity      = severity,
            p_detail        = new
            {
                invocation_id      = invocationId,
                slug,
                compensation_token = compToken,
                message            = result.Message,
            },
        }, ct);

        Console.Error.WriteLine($"[CompensationExecutor] {action} invocation={invocationId} slug={slug} msg={result.Message}");
        return result;
    }

    // ── Yol 2: Orchestrator — in-memory exchange listesi ────────────────────

    /// <summary>
    /// Adım exception/abort durumunda, o adımın in-memory exchange'lerini geri alır.
    /// DB'de invocation güncellenmez (id bilinmiyor); yalnız audit_log'a yazar.
    /// Null DB'de de güvenli — audit log atlanır.
    /// </summary>
    public async Task CompensateExchangesAsync(
        IEnumerable<ToolExchange> exchanges,
        SupabaseWriter? db,
        string? ownerId,
        string runId,
        string agentId,
        CancellationToken ct)
    {
        foreach (var ex in exchanges)
        {
            var token = ex.Result.CompensationToken;
            if (string.IsNullOrWhiteSpace(token)) continue;
            if (!_tools.TryGetValue(ex.Call.Slug, out var tool)) continue;
            if (tool is not ICompensable compensable) continue;

            CompensationResult result;
            try
            {
                result = await compensable.CompensateAsync(token, db, ownerId, ct);
            }
            catch (OperationCanceledException)
            {
                throw;
            }
            catch (Exception cex)
            {
                result = CompensationResult.Failure($"Beklenmeyen hata: {cex.Message}");
            }

            var action   = result.Ok ? "tool.compensated" : "tool.compensation_failed";
            var severity = result.Ok ? "info" : "error";
            Console.Error.WriteLine($"[CompensationExecutor] {action} runId={runId} slug={ex.Call.Slug} msg={result.Message}");

            // InvocationId varsa DB satırını güncelle (PR4a: çift compensation'ı önler).
            if (db is not null && !string.IsNullOrWhiteSpace(ex.Result.InvocationId))
            {
                var compStatus = result.Ok ? "succeeded" : "failed";
                await db.PatchAsync(
                    "tool_invocations",
                    $"id=eq.{Uri.EscapeDataString(ex.Result.InvocationId!)}",
                    new { compensated_at = DateTimeOffset.UtcNow, compensation_status = compStatus },
                    ct);
            }

            if (db is not null)
            {
                await db.CallRpcAsync("append_audit_log", new
                {
                    p_owner_user_id = ownerId,
                    p_actor_type    = "system",
                    p_actor_id      = "compensation_executor",
                    p_action        = action,
                    p_resource_type = "tool",
                    p_risk_level    = (string?)null,
                    p_severity      = severity,
                    p_detail        = new
                    {
                        run_id             = runId,
                        agent_id           = agentId,
                        slug               = ex.Call.Slug,
                        compensation_token = token,
                        message            = result.Message,
                    },
                }, ct);
            }
        }
    }
}
