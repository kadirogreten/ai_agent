using System.Text.Json;

namespace AgentArmy.Cli;

// Faz A — Tool Invocation: yürütücü (PR2 + PR5).
// Tasarım: docs/faz-a-tool-invocation-tasarim.md (§3.2, §3.4, §3.5)
//
// Pipeline: çözümle → izin → Faz A güvenliği → (yan etkiliyse RiskGate) → invoke → kaydet.
//   - read araçları: izin + Faz A güvenliği geçerse doğrudan çalışır.
//   - write/external araçlar: RiskGate'ten geçer (R0/R1 oto, R2/R3 onay kuyruğu); yüksek
//     riskte DB/owner yoksa fail-closed.
//   - geri-alınamaz yan etkili araçlar Faz A'da reddedilir.
//   - her çağrı run_events + tool_invocations'a; yan etkili/engellenen/başarısız çağrılar
//     ayrıca immutable audit_log'a (append_audit_log RPC) yazılır.

public sealed class ToolExecutor : IToolExecutor
{
    private readonly IReadOnlyDictionary<string, ITool> _tools;

    public ToolExecutor(IEnumerable<ITool> tools)
    {
        var map = new Dictionary<string, ITool>(StringComparer.OrdinalIgnoreCase);
        foreach (var t in tools) map[t.Slug] = t;
        _tools = map;
    }

    /// <summary>Faz A varsayılan kaydı: aktif araçlar.</summary>
    public static ToolExecutor CreateDefault() => new(new ITool[]
    {
        new WebScrapeTool(),
        new FileStoreTool(),
        new LinkCheckTool(),
        // Tedarik otomasyonu araçları: stok → ürün arama (gerçek) → satın alma (R3 onay) → kargo.
        new StockCheckTool(),
        new ProductSearchTool(),
        new PurchaseOrderTool(),
        new CargoTrackTool(),
    });

    public IReadOnlyList<ToolDescriptor> AvailableFor(Agent agent, TaskContract contract)
    {
        var perms = ToolPermissions.Parse(contract.ToolPermissions);
        var list = new List<ToolDescriptor>();
        foreach (var tool in _tools.Values)
        {
            if (!perms.IsToolAllowed(tool.Slug)) continue;       // görevde izinli değil
            if (!tool.Descriptor.IsAllowedInPhaseA) continue;    // geri-alınamaz yan etkili → sunma
            list.Add(tool.Descriptor);
        }
        return list;
    }

    public async Task<ToolResult> ExecuteAsync(string slug, JsonElement args, Agent agent, RunContext ctx, CancellationToken ct)
    {
        slug = (slug ?? string.Empty).Trim();

        // 1) Çözümle
        if (!_tools.TryGetValue(slug, out var tool))
            return await FinishAsync(ctx, slug, agent.Id, args, sideEffect: null, riskLevel: null, approvalQueueId: null,
                ToolResult.Failure(slug, $"Bilinmeyen araç: '{slug}'"), ToolInvocationStatus.Failed, ct);

        var desc       = tool.Descriptor;
        var sideEffect = desc.SideEffect.ToDbString();
        var effRisk    = desc.EffectiveRisk(ctx.Contract.Risk);

        // 2) İzin (görev sözleşmesi). agent_tools DB kesişimi sonraki PR'da eklenecek.
        var perms = ToolPermissions.Parse(ctx.Contract.ToolPermissions);
        if (!perms.IsToolAllowed(slug))
            return await FinishAsync(ctx, slug, agent.Id, args, sideEffect, effRisk, null,
                ToolResult.Failure(slug, $"Araç '{slug}' görev izinlerinde yok."), ToolInvocationStatus.Blocked, ct);

        // 3) Faz A güvenlik kuralı: geri-alınamaz yan etkili araç yasak.
        if (!desc.IsAllowedInPhaseA)
            return await FinishAsync(ctx, slug, agent.Id, args, sideEffect, effRisk, null,
                ToolResult.Failure(slug, $"'{slug}' geri-alınamaz yan etkili — Faz A'da yasak."), ToolInvocationStatus.Blocked, ct);

        // 4) Yan etkili araç → RiskGate. R0/R1 oto-onay; R2/R3 onay kuyruğu; yüksek riskte bypass = fail-closed.
        string? approvalQueueId = null;
        if (desc.SideEffect.HasSideEffect())
        {
            var gate    = await RiskGate.GateForToolAsync(ctx.Db, effRisk, ctx.RunId, agent.Id, slug, ArgsToObject(args), ct);
            approvalQueueId = gate.ApprovalQueueId;
            var highRisk = RiskPolicy.Rank(effRisk) >= 2;
            var bypassed = gate.Reason is not null && gate.Reason.Contains("bypass", StringComparison.OrdinalIgnoreCase);
            if (!gate.Approved || (highRisk && bypassed))
                return await FinishAsync(ctx, slug, agent.Id, args, sideEffect, effRisk, approvalQueueId,
                    ToolResult.Failure(slug, $"Onay alınamadı ({gate.Reason ?? "bilinmiyor"})."),
                    ToolInvocationStatus.Blocked, ct);
        }

        // 5) Argüman temel doğrulaması (tam JSON Schema doğrulaması sonraki PR'da).
        if (args.ValueKind is not (JsonValueKind.Object or JsonValueKind.Undefined))
            return await FinishAsync(ctx, slug, agent.Id, args, sideEffect, effRisk, approvalQueueId,
                ToolResult.Failure(slug, "Argümanlar bir JSON nesnesi olmalı."), ToolInvocationStatus.Failed, ct);

        // 6) Çalıştır
        ToolResult result;
        try
        {
            result = await tool.InvokeAsync(args, ctx, ct);
        }
        catch (OperationCanceledException)
        {
            throw; // gerçek iptal — run seviyesine yükselt
        }
        catch (Exception ex)
        {
            result = ToolResult.Failure(slug, $"Araç hatası: {ex.Message}");
        }

        var status = result.Ok ? ToolInvocationStatus.Succeeded : ToolInvocationStatus.Failed;
        return await FinishAsync(ctx, slug, agent.Id, args, sideEffect, effRisk, approvalQueueId, result, status, ct);
    }

    private static object? ArgsToObject(JsonElement args)
        => args.ValueKind == JsonValueKind.Undefined ? null : args;

    /// <summary>Sonucu kaydeder (event log + tool_invocations + gerekirse audit_log) ve sonucu döner.</summary>
    private static async Task<ToolResult> FinishAsync(
        RunContext ctx, string slug, string agentId, JsonElement args, string? sideEffect, string? riskLevel,
        string? approvalQueueId, ToolResult result, ToolInvocationStatus status, CancellationToken ct)
    {
        var statusStr = status.ToDbString();

        // Event log — run_events (her zaman; DB yoksa no-op)
        await ctx.AppendLogAsync(new
        {
            type   = "tool_invoked",
            ts     = DateTimeOffset.UtcNow,
            runId  = ctx.RunId,
            agent  = agentId,
            slug,
            status = statusStr,
            ok     = result.Ok,
            error  = result.Error,
        }, ct);

        if (ctx.Db is null || ctx.OwnerId is null)
            return result;

        // Kalıcı kayıt — tool_invocations
        try
        {
            await ctx.Db.InsertAsync("tool_invocations", new
            {
                id                 = Guid.NewGuid().ToString(),
                owner_user_id      = ctx.OwnerId,
                run_id             = ctx.RunId,
                agent_id           = agentId,
                tool_slug          = slug,
                args               = args.ValueKind == JsonValueKind.Undefined ? (object?)null : args,
                status             = statusStr,
                risk_level         = riskLevel,
                side_effect        = sideEffect,
                output             = result.Output is { ValueKind: not JsonValueKind.Undefined } o ? (object?)o : null,
                compensation_token = result.CompensationToken,
                approval_queue_id  = approvalQueueId,
                error              = result.Error,
            }, ct);
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine($"[ToolExecutor] tool_invocations yazılamadı: {ex.Message}");
        }

        // Immutable audit — yan etkili VEYA engellenmiş/başarısız çağrılar.
        var auditWorthy = sideEffect is "write" or "external"
                          || status is ToolInvocationStatus.Blocked or ToolInvocationStatus.Failed;
        if (auditWorthy)
        {
            var severity = status switch
            {
                ToolInvocationStatus.Failed  => "error",
                ToolInvocationStatus.Blocked => "warn",
                _                            => "info",
            };
            try
            {
                await ctx.Db.CallRpcAsync("append_audit_log", new
                {
                    p_owner_user_id = ctx.OwnerId,
                    p_actor_type    = "agent",
                    p_actor_id      = agentId,
                    p_action        = "tool." + statusStr,
                    p_resource_type = "tool",
                    p_risk_level    = riskLevel,
                    p_severity      = severity,
                    p_detail        = new
                    {
                        slug,
                        side_effect        = sideEffect,
                        error              = result.Error,
                        compensation_token = result.CompensationToken,
                        approval_queue_id  = approvalQueueId,
                    },
                }, ct);
            }
            catch (Exception ex)
            {
                Console.Error.WriteLine($"[ToolExecutor] audit_log yazılamadı: {ex.Message}");
            }
        }

        return result;
    }
}
