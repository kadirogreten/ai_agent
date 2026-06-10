using System.Text.Json;

namespace AgentArmy.Cli;

public static partial class CommandDispatcher
{
    public static async Task<int> ExecuteAsync(string rootDir, string[] args, CancellationToken ct)
    {
        if (args.Length == 0)
        {
            Console.WriteLine(HelpText.Build());
            return 1;
        }

        var cmd  = args[0].Trim().ToLowerInvariant();
        var tail = args.Skip(1).ToArray();
        return cmd switch
        {
            "list"        => ListPlaybooks(rootDir, tail),
            "bundles"     => ListBundles(rootDir, tail),
            "run"         => await RunPlaybookAsync(rootDir, tail, ct),
            "bundle"      => await RunBundleAsync(rootDir, tail, ct),
            "ceo"         => await CeoAsync(rootDir, tail, ct),
            "ceo-iterate" => await CeoIterateAsync(rootDir, tail, ct),
            "setup"       => Setup(rootDir, tail),
            "setup-env"   => SetupFromEnv(rootDir, tail),
            "compensate"  => await CompensateAsync(rootDir, tail, ct),
            _             => Unknown()
        };
    }

    // ── Supabase config yardımcısı ───────────────────────────────────────────
    private static LocalConfig.SupabaseConfigSection GetSupabase(string rootDir)
    {
        var local = LocalConfig.TryLoad(rootDir);
        return local?.GetSupabase() ?? new LocalConfig.SupabaseConfigSection();
    }

    // ── DB-first DomainPack yükleyici ────────────────────────────────────────
    private static async Task<DomainPack?> LoadPackAsync(
        string rootDir, string? packId, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(packId)) return null;
        var supabase = GetSupabase(rootDir);
        return await DomainPackLoader.TryLoadAsync(rootDir, packId, supabase, ct);
    }

    // ── DB-first Playbook yükleyici ──────────────────────────────────────────
    private static async Task<Playbook> LoadPlaybookAsync(
        string rootDir, DomainPack? pack, string playbookId, CancellationToken ct)
    {
        var supabase = GetSupabase(rootDir);
        return await PlaybookLoader.LoadAsync(rootDir, pack, playbookId, supabase, ct);
    }

    // ── Komutlar ─────────────────────────────────────────────────────────────

    private static int Unknown()
    {
        Console.WriteLine(HelpText.Build());
        return 1;
    }

    private static int ListPlaybooks(string rootDir, string[] args)
    {
        var parsed = Args.Parse(args);
        var packId = parsed.GetValueOrDefault("domainPack")
                     ?? Environment.GetEnvironmentVariable("AGENTARMY_DOMAIN_PACK");
        var pack   = DomainPackLoader.TryLoad(rootDir, packId);
        foreach (var id in PlaybookLoader.ListPlaybooks(rootDir, pack))
            Console.WriteLine(id);
        return 0;
    }

    private static int ListBundles(string rootDir, string[] args)
    {
        var parsed = Args.Parse(args);
        var packId = parsed.GetValueOrDefault("domainPack")
                     ?? Environment.GetEnvironmentVariable("AGENTARMY_DOMAIN_PACK");
        var pack   = DomainPackLoader.TryLoad(rootDir, packId);
        foreach (var id in BundleLoader.ListBundles(rootDir, pack))
            Console.WriteLine(id);
        return 0;
    }

    private static async Task<int> RunPlaybookAsync(string rootDir, string[] args, CancellationToken ct)
    {
        var parsed       = Args.Parse(args);
        var domainPackId = parsed.GetValueOrDefault("domainPack")
                           ?? Environment.GetEnvironmentVariable("AGENTARMY_DOMAIN_PACK");

        if (!parsed.TryGetValue("playbook", out var playbookId) || string.IsNullOrWhiteSpace(playbookId))
        {
            Console.Error.WriteLine("Missing --playbook");
            return 1;
        }

        var domainPack = await LoadPackAsync(rootDir, domainPackId, ct);
        var playbook   = await LoadPlaybookAsync(rootDir, domainPack, playbookId, ct);

        RiskPolicy.MergeDefaultRiskFromPlaybooks(parsed, new[] { playbook });
        RiskPolicy.Enforce(parsed);

        var exec     = Runner.BuildExecution(rootDir, parsed, domainPackId, domainPack);
        var supabase = GetSupabase(rootDir);
        var runId    = DateTimeOffset.UtcNow.ToString("yyyyMMdd_HHmmss") + "_" + playbook.Id;
        var runDir   = Path.Combine(rootDir, "runs", runId);  // sadece image dosyaları için

        await Runner.RunOneAsync(rootDir, exec, playbook, runId, runDir, supabase, ct);
        Console.WriteLine(runId);
        return 0;
    }

    private static async Task<int> RunBundleAsync(string rootDir, string[] args, CancellationToken ct)
    {
        var parsed       = Args.Parse(args);
        var domainPackId = parsed.GetValueOrDefault("domainPack")
                           ?? Environment.GetEnvironmentVariable("AGENTARMY_DOMAIN_PACK");

        var domainPack = await LoadPackAsync(rootDir, domainPackId, ct);
        if (domainPack is null)
        {
            Console.Error.WriteLine("Bundle requires a domain pack. Use --domainPack <id>");
            return 1;
        }

        var bundleId = parsed.GetValueOrDefault("id") ?? "weekly";
        var bundle   = await BundleLoader.LoadAsync(rootDir, domainPack, bundleId, GetSupabase(rootDir), ct);

        var playbooks = new List<Playbook>();
        foreach (var pid in bundle.Playbooks)
            playbooks.Add(await LoadPlaybookAsync(rootDir, domainPack, pid, ct));

        RiskPolicy.MergeDefaultRiskFromPlaybooks(parsed, playbooks);
        RiskPolicy.Enforce(parsed);

        var exec     = Runner.BuildExecution(rootDir, parsed, domainPackId, domainPack);
        var supabase = GetSupabase(rootDir);
        var topic    = parsed.GetValueOrDefault("topic") ?? string.Empty;
        var result = await Runner.RunBundleAsync(rootDir, exec, bundle, topic, supabase, ct);
        if (result.PlaybookRunIds.Count > 0)
            Console.WriteLine("PLAYBOOK_RUN_IDS=" + string.Join(",", result.PlaybookRunIds));
        Console.WriteLine(result.BundleRunId);
        return 0;
    }

    // ── CEO ortak yardımcılar ────────────────────────────────────────────────

    private static (ILlmClient llm, HttpClient? http) BuildPlannerLlm(Runner.Execution exec)
    {
        if (exec.DryRun)
            return (new FakeLlmClient(), null);

        if (string.IsNullOrWhiteSpace(exec.ApiKey))
            throw new InvalidOperationException("Missing OpenAI API key.");

        // Paylaşılan handler; HttpClient dispose edilse de handler ölmez.
        var http = new HttpClient(HttpClientPool.SharedHandler, disposeHandler: false)
        {
            Timeout = TimeSpan.FromMinutes(5)
        };
        var llm  = new OpenAiResponsesClient(http, exec.ApiKey, exec.Model, enableWebSearch: false);
        return (llm, http);
    }

    private static async Task<int> RunCeoFlowAsync(
        string rootDir,
        string request,
        string? answersJson,
        Dictionary<string, string> parsed,
        DomainPack pack,
        CancellationToken ct)
    {
        var exec     = Runner.BuildExecution(rootDir, parsed, pack.Id);
        var supabase = GetSupabase(rootDir);
        var (llm, http) = BuildPlannerLlm(exec);

        using (http)
        {
            // DB önce inşa ediliyor; planner facts'leri DB'den okusun.
            using var db = SupabaseWriter.TryCreate(supabase);
            var planner = new CeoPlanner(llm, db);
            var plan    = await planner.PlanAsync(request, answersJson, pack, ct);

            // CEO planını DB'ye yaz
            if (db is not null)
            {
                await db.InsertAsync("ceo_plans", new
                {
                    domain_pack          = pack.Id,
                    request_text         = request,
                    answers_json         = string.IsNullOrWhiteSpace(answersJson)
                        ? (object?)null
                        : JsonSerializer.Deserialize<JsonElement>(answersJson),
                    primary_topic        = plan.PrimaryTopic,
                    subtopics            = plan.Subtopics,
                    rationale            = plan.Rationale,
                    clarifying_questions = plan.ClarifyingQuestions
                }, ct);
            }

            if (plan.ClarifyingQuestions.Count > 0)
            {
                Console.WriteLine("CEO soruları:");
                foreach (var q in plan.ClarifyingQuestions) Console.WriteLine("- " + q);
                Console.WriteLine();
            }

            var maxRetries  = int.TryParse(parsed.GetValueOrDefault("maxRetries")  ?? Environment.GetEnvironmentVariable("CEO_MAX_RETRIES"),  out var mr) ? mr : 2;
            // Kapı 2: Dinamik paralelleşme — kullanıcı override etmediyse plan.runs.Count'a göre
            // otomatik olarak up to 3 paralel çalış. Tek run'lı planlarda 1 kalır.
            var maxParallel = int.TryParse(parsed.GetValueOrDefault("maxParallel") ?? Environment.GetEnvironmentVariable("CEO_MAX_PARALLEL"), out var mp)
                ? mp
                : Math.Min(Math.Max(plan.Runs.Count, 1), 3);

            var executor = new CeoExecutor(rootDir, exec, pack, maxRetries, maxParallel, supabase);
            var result   = await executor.ExecuteAsync(plan, parsed, ct);

            // Worker'ın run_outputs tablosunu bulabilmesi için tüm playbook run ID'lerini yaz.
            var allRunIds = result.Runs
                .Where(r => r.Success)
                .SelectMany(r =>
                {
                    if (r.PlaybookRunIds is { Count: > 0 }) return r.PlaybookRunIds;
                    if (r.RunId is not null) return new[] { r.RunId };
                    return Array.Empty<string>();
                })
                .Distinct()
                .ToList();

            if (allRunIds.Count > 0)
                Console.WriteLine($"PLAYBOOK_RUN_IDS={string.Join(",", allRunIds)}");

            Console.WriteLine(result.Succeeded > 0 ? "OK" : "FAILED");
            return result.Failed > 0 ? 1 : 0;
        }
    }

    private static async Task<int> CeoAsync(string rootDir, string[] args, CancellationToken ct)
    {
        var parsed       = Args.Parse(args);
        var domainPackId = parsed.GetValueOrDefault("domainPack")
                           ?? Environment.GetEnvironmentVariable("AGENTARMY_DOMAIN_PACK");

        var pack = await LoadPackAsync(rootDir, domainPackId, ct);
        if (pack is null) { Console.Error.WriteLine("CEO requires a domain pack."); return 1; }

        var request = parsed.GetValueOrDefault("request") ?? string.Empty;
        if (string.IsNullOrWhiteSpace(request)) { Console.Error.WriteLine("Missing --request"); return 1; }

        return await RunCeoFlowAsync(rootDir, request, answersJson: null, parsed, pack, ct);
    }

    private static async Task<int> CeoIterateAsync(string rootDir, string[] args, CancellationToken ct)
    {
        var parsed       = Args.Parse(args);
        var domainPackId = parsed.GetValueOrDefault("domainPack")
                           ?? Environment.GetEnvironmentVariable("AGENTARMY_DOMAIN_PACK");

        var pack = await LoadPackAsync(rootDir, domainPackId, ct);
        if (pack is null) { Console.Error.WriteLine("CEO requires a domain pack."); return 1; }

        var request = parsed.GetValueOrDefault("request") ?? string.Empty;
        if (string.IsNullOrWhiteSpace(request)) { Console.Error.WriteLine("Missing --request"); return 1; }

        var answers = parsed.GetValueOrDefault("answers") ?? string.Empty;
        if (string.IsNullOrWhiteSpace(answers)) { Console.Error.WriteLine("Missing --answers (JSON string)"); return 1; }

        return await RunCeoFlowAsync(rootDir, request, answers, parsed, pack, ct);
    }

    // ── Compensate komutu ────────────────────────────────────────────────────

    private static async Task<int> CompensateAsync(string rootDir, string[] args, CancellationToken ct)
    {
        var parsed = Args.Parse(args);
        if (!parsed.TryGetValue("invocationId", out var invocationId) || string.IsNullOrWhiteSpace(invocationId))
        {
            Console.Error.WriteLine("Missing --invocationId");
            return 1;
        }

        var ownerId  = Environment.GetEnvironmentVariable("RUN_OWNER_USER_ID");
        var supabase = GetSupabase(rootDir);

        using var db = SupabaseWriter.TryCreate(supabase);
        if (db is null)
        {
            Console.Error.WriteLine("Supabase bağlantısı yapılandırılmamış; compensate çalışamıyor.");
            return 1;
        }

        var executor = new CompensationExecutor(ToolExecutor.CreateDefault().GetTools().Values);
        var result   = await executor.CompensateInvocationAsync(invocationId, db, ownerId, ct);

        if (result.Ok)
        {
            Console.WriteLine($"OK: {result.Message}");
            return 0;
        }
        Console.Error.WriteLine($"FAILED: {result.Message}");
        return 1;
    }

    // ── Setup komutları ──────────────────────────────────────────────────────

    private static int Setup(string rootDir, string[] args)
    {
        var parsed = Args.Parse(args);
        var model  = parsed.GetValueOrDefault("model")
                     ?? Environment.GetEnvironmentVariable("OPENAI_MODEL")
                     ?? "gpt-4.1";

        Console.Write("OpenAI API key: ");
        var key = SecretInput.ReadHiddenLine().Trim();
        if (string.IsNullOrWhiteSpace(key))
        {
            Console.Error.WriteLine("Empty key; cancelled.");
            return 1;
        }

        LocalConfigWriter.Write(rootDir, key, model);
        Console.WriteLine("Saved to agentarmy.local.json (gitignored).");
        return 0;
    }

    private static int SetupFromEnv(string rootDir, string[] args)
    {
        var parsed = Args.Parse(args);
        var model  = parsed.GetValueOrDefault("model")
                     ?? Environment.GetEnvironmentVariable("OPENAI_MODEL")
                     ?? "gpt-4.1";

        var key = Environment.GetEnvironmentVariable("OPENAI_API_KEY");
        if (string.IsNullOrWhiteSpace(key))
        {
            Console.Error.WriteLine("Missing OPENAI_API_KEY in environment.");
            return 1;
        }

        LocalConfigWriter.Write(rootDir, key.Trim(), model);
        Console.WriteLine("Saved to agentarmy.local.json (gitignored).");
        return 0;
    }
}
