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
    private readonly IRiskGate      _gate;
    private readonly IBudgetChecker _budget;

    /// <summary>
    /// Üretim ctor — adapter'lar otomatik kullanılır.
    /// Testler <paramref name="gate"/> ve <paramref name="budget"/> enjekte eder.
    /// </summary>
    public ToolExecutor(
        IEnumerable<ITool> tools,
        IRiskGate?      gate   = null,
        IBudgetChecker? budget = null)
    {
        var map = new Dictionary<string, ITool>(StringComparer.OrdinalIgnoreCase);
        foreach (var t in tools) map[t.Slug] = t;
        _tools  = map;
        _gate   = gate   ?? new RiskGateAdapter();
        _budget = budget ?? new BudgetCheckerAdapter();
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
        new StockReplenishTool(),
    });

    /// <summary>Tüm kayıtlı araçları döner (CompensationExecutor için).</summary>
    public IReadOnlyDictionary<string, ITool> GetTools() => _tools;

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

        // 1b) tools.enabled kontrolü: run başında yüklenen harita; null → tüm araçlar enabled.
        if (ctx.ToolEnabledMap is not null &&
            ctx.ToolEnabledMap.TryGetValue(slug, out var isEnabled) && !isEnabled)
        {
            // Disabled audit: append_audit_log + tool.disabled action
            if (ctx.Db is not null && ctx.OwnerId is not null)
            {
                try
                {
                    await ctx.Db.CallRpcAsync("append_audit_log", new
                    {
                        p_owner_user_id = ctx.OwnerId,
                        p_actor_type    = "agent",
                        p_actor_id      = agent.Id,
                        p_action        = "tool.disabled",
                        p_resource_type = "tool",
                        p_risk_level    = effRisk,
                        p_severity      = "warn",
                        p_detail        = new { slug, reason = "Tool is disabled in registry." },
                    }, ct);
                }
                catch (Exception ex)
                {
                    Console.Error.WriteLine($"[ToolExecutor] tool.disabled audit yazılamadı: {ex.Message}");
                }
            }
            return await FinishAsync(ctx, slug, agent.Id, args, sideEffect, effRisk, null,
                ToolResult.Failure(slug, $"Araç '{slug}' devre dışı (ToolsPage'den etkinleştirilebilir)."),
                ToolInvocationStatus.Blocked, ct);
        }

        // 2) İzin (görev sözleşmesi). agent_tools DB kesişimi sonraki PR'da eklenecek.
        var perms = ToolPermissions.Parse(ctx.Contract.ToolPermissions);
        if (!perms.IsToolAllowed(slug))
            return await FinishAsync(ctx, slug, agent.Id, args, sideEffect, effRisk, null,
                ToolResult.Failure(slug, $"Araç '{slug}' görev izinlerinde yok."), ToolInvocationStatus.Blocked, ct);

        // 3) Faz A güvenlik kuralı: geri-alınamaz yan etkili araç yasak.
        if (!desc.IsAllowedInPhaseA)
            return await FinishAsync(ctx, slug, agent.Id, args, sideEffect, effRisk, null,
                ToolResult.Failure(slug, $"'{slug}' geri-alınamaz yan etkili — Faz A'da yasak."), ToolInvocationStatus.Blocked, ct);

        // 4a) Bütçe kilidi: yan etkili her araç için koşulsuz çağrılır.
        //     Null-DB toleransı BudgetCheckerAdapter içinde kalır (allowed=true döner).
        //     Guard kaldırıldı: IBudgetChecker enjekte edilebilir, test çifti çalışabilir.
        if (desc.SideEffect.HasSideEffect())
        {
            var amount = BudgetChecker.ExtractAmount(args);
            var budgetResult = await _budget.ConsumeAsync(ctx.Db, ctx.OwnerId, slug, amount, ct);
            if (!budgetResult.Allowed)
            {
                var failResult = ToolResult.Failure(slug, $"Bütçe aşıldı ({budgetResult.Reason}).");
                try
                {
                    if (ctx.Db is not null && ctx.OwnerId is not null)
                        await ctx.Db.CallRpcAsync("append_audit_log", new
                        {
                            p_owner_user_id = ctx.OwnerId,
                            p_actor_type    = "agent",
                            p_actor_id      = agent.Id,
                            p_action        = "budget.exceeded",
                            p_resource_type = "tool",
                            p_risk_level    = effRisk,
                            p_severity      = "warn",
                            p_detail        = new { slug, reason = budgetResult.Reason, amount },
                        }, ct);
                }
                catch (Exception ex)
                {
                    Console.Error.WriteLine($"[ToolExecutor] budget.exceeded audit yazılamadı: {ex.Message}");
                }
                return await FinishAsync(ctx, slug, agent.Id, args, sideEffect, effRisk, null,
                    failResult, ToolInvocationStatus.Blocked, ct);
            }
        }

        // 4b) Yan etkili araç → RiskGate (instance _gate; testler FakeRiskGate enjekte eder).
        //     R0/R1 oto-onay; R2/R3 onay kuyruğu; yüksek riskte bypass = fail-closed.
        string? approvalQueueId = null;
        if (desc.SideEffect.HasSideEffect())
        {
            var gateResult  = await _gate.GateForToolAsync(ctx.Db, effRisk, ctx.RunId, agent.Id, slug, ArgsToObject(args), ct);
            approvalQueueId = gateResult.ApprovalQueueId;
            var highRisk = RiskPolicy.Rank(effRisk) >= 2;
            var bypassed = gateResult.Reason is not null && gateResult.Reason.Contains("bypass", StringComparison.OrdinalIgnoreCase);
            if (!gateResult.Approved || (highRisk && bypassed))
                return await FinishAsync(ctx, slug, agent.Id, args, sideEffect, effRisk, approvalQueueId,
                    ToolResult.Failure(slug, $"Onay alınamadı ({gateResult.Reason ?? "bilinmiyor"})."),
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

        // Teşhis — her araç çağrısının sonucu GitHub Actions / worker logunda görünsün.
        Console.Error.WriteLine(
            $"[Tool] {slug} agent={agentId} status={statusStr} risk={riskLevel ?? "-"} sideEffect={sideEffect ?? "-"}"
            + (approvalQueueId is not null ? $" approval={approvalQueueId}" : "")
            + (result.Error is not null ? $" error=\"{result.Error}\"" : ""));

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

        // Kalıcı kayıt — tool_invocations.
        // id istemci taraflı üretilir (RiskGate.queueId deseni) → ToolResult.InvocationId'ye taşınır.
        // CompensateExchangesAsync bu id ile in-flight compensation sırasında DB satırını patch'ler.
        var invocationId = result.InvocationId ?? Guid.NewGuid().ToString();
        result = result with { InvocationId = invocationId };

        try
        {
            await ctx.Db.InsertAsync("tool_invocations", new
            {
                id                 = invocationId,
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

        return result with { InvocationId = invocationId };
    }
}
