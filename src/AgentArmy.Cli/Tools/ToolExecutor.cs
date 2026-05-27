using System.Text.Json;

namespace AgentArmy.Cli;

// Faz A — Tool Invocation: yürütücü (PR2).
// Tasarım: docs/faz-a-tool-invocation-tasarim.md (§3.2)
//
// Bu PR'da:
//   - read araçları izin + Faz A güvenliği geçerse çalışır,
//   - yan etkili araçlar fail-closed reddedilir (RiskGate bağlanana kadar — PR5),
//   - her çağrı run_events'e (event log) ve mümkünse tool_invocations'a yazılır.
//   - Tam JSON Schema doğrulaması ve agent_tools DB kesişimi sonraki PR'larda eklenecek.

public sealed class ToolExecutor : IToolExecutor
{
    private readonly IReadOnlyDictionary<string, ITool> _tools;

    public ToolExecutor(IEnumerable<ITool> tools)
    {
        var map = new Dictionary<string, ITool>(StringComparer.OrdinalIgnoreCase);
        foreach (var t in tools) map[t.Slug] = t;
        _tools = map;
    }

    /// <summary>Faz A varsayılan kaydı: aktif read araçları.</summary>
    public static ToolExecutor CreateDefault() => new(new ITool[]
    {
        new WebScrapeTool(),
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
            return await FinishAsync(ctx, slug, agent.Id, args, sideEffect: null,
                ToolResult.Failure(slug, $"Bilinmeyen araç: '{slug}'"), ToolInvocationStatus.Failed, ct);

        var desc = tool.Descriptor;
        var sideEffect = desc.SideEffect.ToDbString();

        // 2) İzin (görev sözleşmesi). agent_tools DB kesişimi sonraki PR'da eklenecek.
        var perms = ToolPermissions.Parse(ctx.Contract.ToolPermissions);
        if (!perms.IsToolAllowed(slug))
            return await FinishAsync(ctx, slug, agent.Id, args, sideEffect,
                ToolResult.Failure(slug, $"Araç '{slug}' görev izinlerinde yok."), ToolInvocationStatus.Blocked, ct);

        // 3) Faz A güvenlik kuralı: geri-alınamaz yan etkili araç yasak.
        if (!desc.IsAllowedInPhaseA)
            return await FinishAsync(ctx, slug, agent.Id, args, sideEffect,
                ToolResult.Failure(slug, $"'{slug}' geri-alınamaz yan etkili — Faz A'da yasak."), ToolInvocationStatus.Blocked, ct);

        // 4) Yan etkili araç → RiskGate gerekir (PR5). Henüz bağlı değil: fail-closed.
        if (desc.SideEffect.HasSideEffect())
            return await FinishAsync(ctx, slug, agent.Id, args, sideEffect,
                ToolResult.Failure(slug, $"'{slug}' yan etkili; onay kapısı (RiskGate) henüz bağlı değil — reddedildi."),
                ToolInvocationStatus.Blocked, ct);

        // 5) Argüman temel doğrulaması (tam JSON Schema doğrulaması sonraki PR'da).
        if (args.ValueKind is not (JsonValueKind.Object or JsonValueKind.Undefined))
            return await FinishAsync(ctx, slug, agent.Id, args, sideEffect,
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
        return await FinishAsync(ctx, slug, agent.Id, args, sideEffect, result, status, ct);
    }

    /// <summary>Sonucu kaydeder (event log + tool_invocations) ve sonucu geri döner.</summary>
    private static async Task<ToolResult> FinishAsync(
        RunContext ctx, string slug, string agentId, JsonElement args, string? sideEffect,
        ToolResult result, ToolInvocationStatus status, CancellationToken ct)
    {
        // Event log — run_events (her zaman, DB yoksa no-op)
        await ctx.AppendLogAsync(new
        {
            type   = "tool_invoked",
            ts     = DateTimeOffset.UtcNow,
            runId  = ctx.RunId,
            agent  = agentId,
            slug,
            status = status.ToDbString(),
            ok     = result.Ok,
            error  = result.Error,
        }, ct);

        // Kalıcı kayıt — tool_invocations (owner gerekli; immutable audit_log RPC'si PR5'te)
        if (ctx.Db is not null && ctx.OwnerId is not null)
        {
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
                    status             = status.ToDbString(),
                    side_effect        = sideEffect,
                    output             = result.Output is { ValueKind: not JsonValueKind.Undefined } o ? (object?)o : null,
                    compensation_token = result.CompensationToken,
                    error              = result.Error,
                }, ct);
            }
            catch (Exception ex)
            {
                Console.Error.WriteLine($"[ToolExecutor] tool_invocations yazılamadı: {ex.Message}");
            }
        }

        return result;
    }
}
