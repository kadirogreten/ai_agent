using System.Text;
using System.Text.Json;

namespace AgentArmy.Cli;

/// <summary>
/// IP1.3 CEO Executor: CeoPlanner.Plan çıktısını yürütür.
/// Özellikler:
///   - max maxRetries yeniden deneme (üstel bekleme)
///   - SemaphoreSlim ile configüre edilebilir paralellik (varsayılan: 1 = sıralı)
///   - Her run için bağımsız hata yakalama — kısmi başarı mümkün
///   - Tüm sonuçlar execution.json dosyasına yazılır
/// </summary>
public sealed class CeoExecutor
{
    private readonly string _rootDir;
    private readonly Runner.Execution _exec;
    private readonly DomainPack _pack;
    private readonly int _maxRetries;
    private readonly int _maxParallel;

    // ── Sonuç modelleri ──────────────────────────────────────────────────────

    public sealed record RunResult(
        string Mode,
        string Id,
        string Topic,
        string Risk,
        bool   Success,
        string? Dir,
        string? Error,
        int    Attempts,
        double DurationSeconds
    );

    public sealed record ExecutionResult(
        string                CeoDir,
        IReadOnlyList<RunResult> Runs,
        int                   Succeeded,
        int                   Failed
    );

    // ── Ctor ─────────────────────────────────────────────────────────────────

    public CeoExecutor(
        string rootDir,
        Runner.Execution exec,
        DomainPack pack,
        int maxRetries  = 2,
        int maxParallel = 1)
    {
        _rootDir    = rootDir;
        _exec       = exec;
        _pack       = pack;
        _maxRetries = maxRetries;
        // SemaphoreSlim değerini güvenli bir aralıkta tut
        _maxParallel = Math.Clamp(maxParallel, 1, 5);
    }

    // ── Ana çalıştırıcı ──────────────────────────────────────────────────────

    /// <summary>
    /// Planı çalıştırır. baseArgs: ComandDispatcher'dan gelen parse edilmiş argümanlar.
    /// </summary>
    public async Task<ExecutionResult> ExecuteAsync(
        CeoPlanner.Plan plan,
        string ceoDir,
        Dictionary<string, string> baseArgs,
        CancellationToken ct)
    {
        var sem = new SemaphoreSlim(_maxParallel, _maxParallel);

        // Her PlannedRun için bağımsız bir Task başlat; hepsini paralel çalıştır (maxParallel kısıtlamasıyla)
        var tasks = plan.Runs
            .Select(r => ExecuteOneWithRetryAsync(r, ceoDir, baseArgs, sem, ct))
            .ToArray();

        var results = await Task.WhenAll(tasks);

        var execResult = new ExecutionResult(
            CeoDir:    ceoDir,
            Runs:      results,
            Succeeded: results.Count(r => r.Success),
            Failed:    results.Count(r => !r.Success)
        );

        // Execution sonucu ceoDir'e yaz
        await WriteExecutionSummaryAsync(execResult, ceoDir, ct);

        return execResult;
    }

    // ── Tek run + retry ──────────────────────────────────────────────────────

    private async Task<RunResult> ExecuteOneWithRetryAsync(
        CeoPlanner.PlannedRun planned,
        string ceoDir,
        Dictionary<string, string> baseArgs,
        SemaphoreSlim sem,
        CancellationToken ct)
    {
        await sem.WaitAsync(ct);
        var started = DateTimeOffset.UtcNow;
        Exception? lastEx = null;

        try
        {
            for (int attempt = 1; attempt <= _maxRetries + 1; attempt++)
            {
                try
                {
                    var dir = await RunOnceAsync(planned, ceoDir, baseArgs, attempt, ct);
                    var elapsed = (DateTimeOffset.UtcNow - started).TotalSeconds;
                    return new RunResult(
                        planned.Mode, planned.Id, planned.Topic, planned.Risk,
                        true, dir, null, attempt, elapsed);
                }
                catch (OperationCanceledException)
                {
                    throw; // İptal durumunu yutma
                }
                catch (Exception ex)
                {
                    lastEx = ex;
                    Console.Error.WriteLine(
                        $"[CeoExecutor] '{planned.Id}' deneme {attempt}/{_maxRetries + 1} başarısız: {ex.Message}");

                    if (attempt <= _maxRetries)
                    {
                        var delay = TimeSpan.FromSeconds(Math.Pow(2, attempt - 1)); // 1s, 2s, 4s...
                        Console.Error.WriteLine($"[CeoExecutor] {delay.TotalSeconds:0}sn bekleniyor, sonra yeniden deneniyor...");
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
        return new RunResult(
            planned.Mode, planned.Id, planned.Topic, planned.Risk,
            false, null, lastEx?.Message ?? "Max deneme aşıldı", _maxRetries + 1, totalElapsed);
    }

    // ── Tek çalıştırma (retry olmadan) ──────────────────────────────────────

    private async Task<string> RunOnceAsync(
        CeoPlanner.PlannedRun planned,
        string ceoDir,
        Dictionary<string, string> baseArgs,
        int attempt,
        CancellationToken ct)
    {
        var runArgs = new Dictionary<string, string>(baseArgs, StringComparer.OrdinalIgnoreCase)
        {
            ["domainPack"] = _pack.Id,
            ["topic"]      = planned.Topic,
            ["risk"]       = planned.Risk,
            ["web"]        = planned.Web ? "true" : "false",
            ["contrarian"] = planned.Contrarian ? "true" : "false",
        };

        RiskPolicy.Enforce(runArgs);
        var runExec = Runner.BuildExecution(_rootDir, runArgs, _pack.Id);

        if (planned.Mode.Equals("bundle", StringComparison.OrdinalIgnoreCase))
        {
            var bundle = BundleLoader.Load(_rootDir, _pack, planned.Id);
            return await Runner.RunBundleAsync(_rootDir, runExec, bundle, planned.Topic, ct);
        }
        else
        {
            var playbook = PlaybookLoader.Load(_rootDir, _pack, planned.Id);
            var suffix   = attempt > 1 ? $"_retry{attempt - 1}" : string.Empty;
            var runId    = DateTimeOffset.UtcNow.ToString("yyyyMMdd_HHmmss") + "_" + playbook.Id;
            var runDir   = Path.Combine(ceoDir, playbook.Id + suffix);
            await Runner.RunOneAsync(_rootDir, runExec, playbook, runId, runDir, ct);
            return runDir;
        }
    }

    // ── Execution özeti ──────────────────────────────────────────────────────

    private static async Task WriteExecutionSummaryAsync(
        ExecutionResult result,
        string ceoDir,
        CancellationToken ct)
    {
        var summary = new
        {
            succeeded    = result.Succeeded,
            failed       = result.Failed,
            total        = result.Runs.Count,
            generatedAt  = DateTimeOffset.UtcNow,
            runs         = result.Runs.Select(r => new
            {
                mode     = r.Mode,
                id       = r.Id,
                topic    = r.Topic,
                risk     = r.Risk,
                success  = r.Success,
                dir      = r.Dir,
                error    = r.Error,
                attempts = r.Attempts,
                duration_seconds = Math.Round(r.DurationSeconds, 2),
            })
        };

        var json = JsonSerializer.Serialize(summary, new JsonSerializerOptions { WriteIndented = true });
        var path = Path.Combine(ceoDir, "execution.json");
        await File.WriteAllTextAsync(path, json + "\n", Encoding.UTF8, ct);

        Console.WriteLine($"[CEO] Çalıştırma tamamlandı: {result.Succeeded}/{result.Runs.Count} başarılı");
        foreach (var r in result.Runs.Where(r => !r.Success))
        {
            Console.Error.WriteLine($"[CEO] BAŞARISIZ: {r.Id} — {r.Error}");
        }
    }
}
