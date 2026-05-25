using System.Text.Json;

namespace AgentArmy.Cli;

/// <summary>
/// CEO Executor: CeoPlanner.Plan çıktısını yürütür.
/// Tüm çıktılar DB'ye yazılır — disk kullanılmaz.
/// </summary>
public sealed class CeoExecutor
{
    private readonly string _rootDir;
    private readonly Runner.Execution _exec;
    private readonly DomainPack _pack;
    private readonly int _maxRetries;
    private readonly int _maxParallel;
    private readonly LocalConfig.SupabaseConfigSection? _supabase;

    public sealed record RunResult(
        string Mode,
        string Id,
        string Topic,
        string Risk,
        bool   Success,
        string? Error,
        int    Attempts,
        double DurationSeconds,
        string? RunId = null,
        IReadOnlyList<string>? PlaybookRunIds = null
    );

    public sealed record ExecutionResult(
        IReadOnlyList<RunResult> Runs,
        int Succeeded,
        int Failed
    );

    public CeoExecutor(
        string rootDir,
        Runner.Execution exec,
        DomainPack pack,
        int maxRetries  = 2,
        int maxParallel = 1,
        LocalConfig.SupabaseConfigSection? supabase = null)
    {
        _rootDir     = rootDir;
        _exec        = exec;
        _pack        = pack;
        _maxRetries  = maxRetries;
        _maxParallel = Math.Clamp(maxParallel, 1, 5);
        _supabase    = supabase;
    }

    public async Task<ExecutionResult> ExecuteAsync(
        CeoPlanner.Plan plan,
        Dictionary<string, string> baseArgs,
        CancellationToken ct)
    {
        var sem = new SemaphoreSlim(_maxParallel, _maxParallel);

        var tasks = plan.Runs
            .Select(r => ExecuteOneWithRetryAsync(r, baseArgs, sem, ct))
            .ToArray();

        var results = await Task.WhenAll(tasks);

        var execResult = new ExecutionResult(
            Runs:      results,
            Succeeded: results.Count(r => r.Success),
            Failed:    results.Count(r => !r.Success)
        );

        await WriteExecutionSummaryAsync(execResult, plan, ct);
        return execResult;
    }

    private async Task<RunResult> ExecuteOneWithRetryAsync(
        CeoPlanner.PlannedRun planned,
        Dictionary<string, string> baseArgs,
        SemaphoreSlim sem,
        CancellationToken ct)
    {
        await sem.WaitAsync(ct);
        var started = DateTimeOffset.UtcNow;
        Exception? lastEx = null;

        try
        {
            // Kapı 2: Risk-gate önce çalışır. R2/R3 onay beklenir; rejected/timeout →
            // retry yok, doğrudan failed döner.
            using var gateDb = _supabase?.IsConfigured == true
                ? new SupabaseWriter(_supabase!.EffectiveUrl!, _supabase!.EffectiveKey!)
                : null;

            var gate = await RiskGate.GateAsync(
                db:            gateDb,
                risk:          planned.Risk,
                runId:         $"{planned.Mode}:{planned.Id}",
                agentId:       "CEO",
                actionSummary: $"CEO {planned.Mode} → {planned.Id} (topic: {planned.Topic})",
                actionDetail:  new { mode = planned.Mode, id = planned.Id, topic = planned.Topic, risk = planned.Risk },
                ct:            ct);

            if (!gate.Approved)
            {
                var elapsed = (DateTimeOffset.UtcNow - started).TotalSeconds;
                return new RunResult(planned.Mode, planned.Id, planned.Topic, planned.Risk,
                    false, $"risk_gate_blocked: {gate.Reason}", 0, elapsed);
            }

            for (int attempt = 1; attempt <= _maxRetries + 1; attempt++)
            {
                try
                {
                    var (runId, childRunIds) = await RunOnceAsync(planned, baseArgs, attempt, ct);

                    // Sector Discovery hook — taslağı DB'ye yaz
                    if (_supabase?.IsConfigured == true &&
                        planned.Id.Contains("sector-discovery", StringComparison.OrdinalIgnoreCase))
                    {
                        _ = Task.Run(async () =>
                        {
                            try
                            {
                                // DomainPackDraftWriter artık run_outputs tablosundan okur
                                using var db = new SupabaseWriter(
                                    _supabase!.EffectiveUrl!, _supabase!.EffectiveKey!);
                                await DomainPackDraftWriter.TryWriteFromDbAsync(
                                    db, runId, planned.Topic, ct: CancellationToken.None);
                            }
                            catch (Exception ex)
                            {
                                Console.Error.WriteLine($"[CeoExecutor] DraftWriter hatası: {ex.Message}");
                            }
                        }, CancellationToken.None);
                    }

                    var elapsed = (DateTimeOffset.UtcNow - started).TotalSeconds;
                    return new RunResult(planned.Mode, planned.Id, planned.Topic, planned.Risk,
                        true, null, attempt, elapsed,
                        RunId: runId,
                        PlaybookRunIds: childRunIds.Count > 0 ? childRunIds : null);
                }
                catch (OperationCanceledException) { throw; }
                catch (Exception ex)
                {
                    lastEx = ex;
                    Console.Error.WriteLine(
                        $"[CeoExecutor] '{planned.Id}' deneme {attempt}/{_maxRetries + 1} başarısız: {ex.Message}");

                    if (attempt <= _maxRetries)
                    {
                        var delay = TimeSpan.FromSeconds(Math.Pow(2, attempt - 1));
                        Console.Error.WriteLine($"[CeoExecutor] {delay.TotalSeconds:0}sn bekleniyor...");
                        await Task.Delay(delay, ct);
                    }
                }
            }
        }
        finally
        {
            sem.Release();
        }

        var totalElapsed = (DateTimeOffset.UtcNow - started).TotalSeconds;
        return new RunResult(planned.Mode, planned.Id, planned.Topic, planned.Risk,
            false, lastEx?.Message ?? "Max deneme aşıldı", _maxRetries + 1, totalElapsed);
    }

    private async Task<(string RunId, IReadOnlyList<string> ChildRunIds)> RunOnceAsync(
        CeoPlanner.PlannedRun planned,
        Dictionary<string, string> baseArgs,
        int attempt,
        CancellationToken ct)
    {
        // Kapı 5: planned.Pack farklıysa o pack'i yükleyip kullan; aksi halde primary.
        var targetPack = _pack;
        if (!string.IsNullOrWhiteSpace(planned.Pack)
            && !string.Equals(planned.Pack, _pack.Id, StringComparison.OrdinalIgnoreCase))
        {
            var loaded = await DomainPackLoader.TryLoadAsync(_rootDir, planned.Pack, _supabase, ct);
            if (loaded is not null) targetPack = loaded;
            else Console.Error.WriteLine($"[CeoExecutor] cross-pack '{planned.Pack}' yüklenemedi, primary kullanılacak.");
        }

        var runArgs = new Dictionary<string, string>(baseArgs, StringComparer.OrdinalIgnoreCase)
        {
            ["domainPack"] = targetPack.Id,
            ["topic"]      = planned.Topic,
            ["risk"]       = planned.Risk,
            ["web"]        = planned.Web       ? "true" : "false",
            ["contrarian"] = planned.Contrarian ? "true" : "false",
        };

        RiskPolicy.Enforce(runArgs);
        var runExec = Runner.BuildExecution(_rootDir, runArgs, targetPack.Id, targetPack);

        if (planned.Mode.Equals("bundle", StringComparison.OrdinalIgnoreCase))
        {
            var bundle = await BundleLoader.LoadAsync(_rootDir, targetPack, planned.Id, _supabase, ct);
            var bundleResult = await Runner.RunBundleAsync(_rootDir, runExec, bundle, planned.Topic, _supabase, ct);
            return (bundleResult.BundleRunId, bundleResult.PlaybookRunIds);
        }
        else
        {
            var playbook = await PlaybookLoader.LoadAsync(_rootDir, targetPack, planned.Id, _supabase, ct);
            var suffix   = attempt > 1 ? $"_retry{attempt - 1}" : string.Empty;
            var runId    = DateTimeOffset.UtcNow.ToString("yyyyMMdd_HHmmss") + "_" + playbook.Id + suffix;
            var runDir   = Path.Combine(_rootDir, "runs", "ceo", runId);  // sadece image için
            await Runner.RunOneAsync(_rootDir, runExec, playbook, runId, runDir, _supabase, ct);
            return (runId, Array.Empty<string>());
        }
    }

    private async Task WriteExecutionSummaryAsync(
        ExecutionResult result,
        CeoPlanner.Plan plan,
        CancellationToken ct)
    {
        Console.WriteLine($"[CEO] Çalıştırma tamamlandı: {result.Succeeded}/{result.Runs.Count} başarılı");
        foreach (var r in result.Runs.Where(r => !r.Success))
            Console.Error.WriteLine($"[CEO] BAŞARISIZ: {r.Id} — {r.Error}");

        if (_supabase?.IsConfigured != true) return;

        using var db = new SupabaseWriter(_supabase!.EffectiveUrl!, _supabase!.EffectiveKey!);
        await db.InsertAsync("ceo_executions", new
        {
            domain_pack = _pack.Id,
            model       = _exec.Model,
            dry_run     = _exec.DryRun,
            succeeded   = result.Succeeded,
            failed      = result.Failed,
            runs        = result.Runs.Select(r => new
            {
                mode             = r.Mode,
                id               = r.Id,
                topic            = r.Topic,
                risk             = r.Risk,
                success          = r.Success,
                error            = r.Error,
                attempts         = r.Attempts,
                duration_seconds = Math.Round(r.DurationSeconds, 2)
            })
        }, ct);
    }
}
