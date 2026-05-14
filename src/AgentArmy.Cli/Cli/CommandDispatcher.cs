using System.Text;

namespace AgentArmy.Cli;

public static class CommandDispatcher
{
    public static async Task<int> ExecuteAsync(string rootDir, string[] args, CancellationToken ct)
    {
        if (args.Length == 0)
        {
            Console.WriteLine(HelpText.Build());
            return 1;
        }

        var cmd = args[0].Trim().ToLowerInvariant();
        var tail = args.Skip(1).ToArray();
        return cmd switch
        {
            "list" => ListPlaybooks(rootDir, tail),
            "bundles" => ListBundles(rootDir, tail),
            "run" => await RunPlaybookAsync(rootDir, tail, ct),
            "bundle" => await RunBundleAsync(rootDir, tail, ct),
            "ceo" => await CeoAsync(rootDir, tail, ct),
            "ceo-iterate" => await CeoIterateAsync(rootDir, tail, ct),
            "setup" => Setup(rootDir, tail),
            "setup-env" => SetupFromEnv(rootDir, tail),
            _ => Unknown()
        };
    }

    private static int Unknown()
    {
        Console.WriteLine(HelpText.Build());
        return 1;
    }

    private static int ListPlaybooks(string rootDir, string[] args)
    {
        var parsed = Args.Parse(args);
        var packId = parsed.GetValueOrDefault("domainPack") ?? Environment.GetEnvironmentVariable("AGENTARMY_DOMAIN_PACK");
        var pack = DomainPackLoader.TryLoad(rootDir, packId);
        foreach (var id in PlaybookLoader.ListPlaybooks(rootDir, pack))
        {
            Console.WriteLine(id);
        }
        return 0;
    }

    private static int ListBundles(string rootDir, string[] args)
    {
        var parsed = Args.Parse(args);
        var packId = parsed.GetValueOrDefault("domainPack") ?? Environment.GetEnvironmentVariable("AGENTARMY_DOMAIN_PACK");
        var pack = DomainPackLoader.TryLoad(rootDir, packId);
        foreach (var id in BundleLoader.ListBundles(rootDir, pack))
        {
            Console.WriteLine(id);
        }
        return 0;
    }

    private static async Task<int> RunPlaybookAsync(string rootDir, string[] args, CancellationToken ct)
    {
        var parsed = Args.Parse(args);
        var domainPackId = parsed.GetValueOrDefault("domainPack") ?? Environment.GetEnvironmentVariable("AGENTARMY_DOMAIN_PACK");
        if (!parsed.TryGetValue("playbook", out var playbookId) || string.IsNullOrWhiteSpace(playbookId))
        {
            Console.Error.WriteLine("Missing --playbook");
            return 1;
        }

        var domainPack = DomainPackLoader.TryLoad(rootDir, domainPackId);
        var playbook = PlaybookLoader.Load(rootDir, domainPack, playbookId);
        RiskPolicy.MergeDefaultRiskFromPlaybooks(parsed, new[] { playbook });
        RiskPolicy.Enforce(parsed);

        var exec = Runner.BuildExecution(rootDir, parsed, domainPackId);
        var runId = DateTimeOffset.UtcNow.ToString("yyyyMMdd_HHmmss") + "_" + playbook.Id;
        var runDir = Path.Combine(rootDir, "runs", runId);
        await Runner.RunOneAsync(rootDir, exec, playbook, runId, runDir, ct);
        Console.WriteLine(runDir);
        return 0;
    }

    private static async Task<int> RunBundleAsync(string rootDir, string[] args, CancellationToken ct)
    {
        var parsed = Args.Parse(args);
        var domainPackId = parsed.GetValueOrDefault("domainPack") ?? Environment.GetEnvironmentVariable("AGENTARMY_DOMAIN_PACK");
        var domainPack = DomainPackLoader.TryLoad(rootDir, domainPackId);
        if (domainPack is null)
        {
            Console.Error.WriteLine("Bundle requires a domain pack. Use --domainPack <id>");
            return 1;
        }

        var bundleId = parsed.GetValueOrDefault("id") ?? "weekly";
        var bundle = BundleLoader.Load(rootDir, domainPack, bundleId);
        var playbooks = bundle.Playbooks
            .Select(pid => PlaybookLoader.Load(rootDir, domainPack, pid))
            .ToList();

        RiskPolicy.MergeDefaultRiskFromPlaybooks(parsed, playbooks);
        RiskPolicy.Enforce(parsed);

        var exec = Runner.BuildExecution(rootDir, parsed, domainPackId);
        var topic = parsed.GetValueOrDefault("topic") ?? string.Empty;
        var dir = await Runner.RunBundleAsync(rootDir, exec, bundle, topic, ct);
        Console.WriteLine(dir);
        return 0;
    }

    private static int Setup(string rootDir, string[] args)
    {
        var parsed = Args.Parse(args);
        var model = parsed.GetValueOrDefault("model")
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
        Console.WriteLine("Saved to agentarmy.local.json (gitignored). ");
        return 0;
    }

    private static int SetupFromEnv(string rootDir, string[] args)
    {
        var parsed = Args.Parse(args);
        var model = parsed.GetValueOrDefault("model")
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

    // IP1.3 CEO: Ortak yardımcı — planner LLM oluştur
    private static (ILlmClient llm, HttpClient? http) BuildPlannerLlm(Runner.Execution exec)
    {
        if (exec.DryRun)
            return (new FakeLlmClient(), null);

        if (string.IsNullOrWhiteSpace(exec.ApiKey))
            throw new InvalidOperationException("Missing OpenAI API key. Set OPENAI_API_KEY or create agentarmy.local.json");

        var http = new HttpClient();
        var llm  = new OpenAiResponsesClient(http, exec.ApiKey, exec.Model, enableWebSearch: false);
        return (llm, http);
    }

    // IP1.3 CEO: Ortak CEO akışı — planlama + dosya yazımı + executor
    private static async Task<int> RunCeoFlowAsync(
        string rootDir,
        string request,
        string? answersJson,
        Dictionary<string, string> parsed,
        DomainPack pack,
        string runSuffix,
        CancellationToken ct)
    {
        var exec = Runner.BuildExecution(rootDir, parsed, pack.Id);
        var (llm, http) = BuildPlannerLlm(exec);
        using (http)
        {
            var planner = new CeoPlanner(llm);
            var plan    = await planner.PlanAsync(request, answersJson, pack, ct);

            var ceoRunId = DateTimeOffset.UtcNow.ToString("yyyyMMdd_HHmmss") + $"_ceo_{runSuffix}_{pack.Id}";
            var ceoDir   = Path.Combine(rootDir, "runs", "ceo", ceoRunId);
            Directory.CreateDirectory(ceoDir);

            // plan.json
            var planJson = System.Text.Json.JsonSerializer.Serialize(
                plan, new System.Text.Json.JsonSerializerOptions { WriteIndented = true });
            await File.WriteAllTextAsync(Path.Combine(ceoDir, "plan.json"), planJson + "\n", Encoding.UTF8, ct);

            // answers.json (iterate modu için)
            if (!string.IsNullOrWhiteSpace(answersJson))
                await File.WriteAllTextAsync(Path.Combine(ceoDir, "answers.json"), answersJson.Trim() + "\n", Encoding.UTF8, ct);

            // questions.md
            if (plan.ClarifyingQuestions.Count > 0)
            {
                var lines = new List<string> { "# Clarifying Questions", "" };
                lines.AddRange(plan.ClarifyingQuestions.Select(q => "- " + q));
                await File.WriteAllTextAsync(Path.Combine(ceoDir, "questions.md"), string.Join("\n", lines) + "\n", Encoding.UTF8, ct);

                Console.WriteLine("CEO soruları (yanıtladıkça isteği daha netleştirip tekrar çalıştırabilirsin):");
                foreach (var q in plan.ClarifyingQuestions) Console.WriteLine("- " + q);
                Console.WriteLine();
            }

            // IP1.3: CeoExecutor — retry + parallel + execution.json
            var maxRetries  = int.TryParse(parsed.GetValueOrDefault("maxRetries") ?? Environment.GetEnvironmentVariable("CEO_MAX_RETRIES"),  out var mr) ? mr : 2;
            var maxParallel = int.TryParse(parsed.GetValueOrDefault("maxParallel") ?? Environment.GetEnvironmentVariable("CEO_MAX_PARALLEL"), out var mp) ? mp : 1;

            var executor = new CeoExecutor(rootDir, exec, pack, maxRetries, maxParallel);
            var result   = await executor.ExecuteAsync(plan, ceoDir, parsed, ct);

            // ceo.json manifest
            var manifest = System.Text.Json.JsonSerializer.Serialize(new
            {
                domainPack  = pack.Id,
                request,
                answers     = answersJson,
                model       = exec.Model,
                dryRun      = exec.DryRun,
                maxRetries,
                maxParallel,
                createdAt   = DateTimeOffset.UtcNow,
                plan        = new { plan.PrimaryTopic, plan.Subtopics, plan.Rationale },
                succeeded   = result.Succeeded,
                failed      = result.Failed,
                runs        = result.Runs.Select(r => new { r.Mode, r.Id, r.Dir, r.Success, r.Error, r.Attempts }),
            }, new System.Text.Json.JsonSerializerOptions { WriteIndented = true });
            await File.WriteAllTextAsync(Path.Combine(ceoDir, "ceo.json"), manifest + "\n", Encoding.UTF8, ct);

            Console.WriteLine(ceoDir);
            return result.Failed > 0 ? 1 : 0;
        }
    }

    private static async Task<int> CeoAsync(string rootDir, string[] args, CancellationToken ct)
    {
        var parsed = Args.Parse(args);
        var domainPackId = parsed.GetValueOrDefault("domainPack") ?? Environment.GetEnvironmentVariable("AGENTARMY_DOMAIN_PACK");
        var pack = DomainPackLoader.TryLoad(rootDir, domainPackId);
        if (pack is null) { Console.Error.WriteLine("CEO requires a domain pack. Use --domainPack market-intel"); return 1; }

        var request = parsed.GetValueOrDefault("request") ?? string.Empty;
        if (string.IsNullOrWhiteSpace(request)) { Console.Error.WriteLine("Missing --request"); return 1; }

        return await RunCeoFlowAsync(rootDir, request, answersJson: null, parsed, pack, "plan", ct);
    }

    private static async Task<int> CeoIterateAsync(string rootDir, string[] args, CancellationToken ct)
    {
        var parsed = Args.Parse(args);
        var domainPackId = parsed.GetValueOrDefault("domainPack") ?? Environment.GetEnvironmentVariable("AGENTARMY_DOMAIN_PACK");
        var pack = DomainPackLoader.TryLoad(rootDir, domainPackId);
        if (pack is null) { Console.Error.WriteLine("CEO requires a domain pack. Use --domainPack market-intel"); return 1; }

        var request = parsed.GetValueOrDefault("request") ?? string.Empty;
        if (string.IsNullOrWhiteSpace(request)) { Console.Error.WriteLine("Missing --request"); return 1; }

        var answers = parsed.GetValueOrDefault("answers") ?? string.Empty;
        if (string.IsNullOrWhiteSpace(answers)) { Console.Error.WriteLine("Missing --answers (JSON string)"); return 1; }

        return await RunCeoFlowAsync(rootDir, request, answers, parsed, pack, "iter", ct);
    }
}
