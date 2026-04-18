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
        RiskPolicy.Enforce(parsed);
        var domainPackId = parsed.GetValueOrDefault("domainPack") ?? Environment.GetEnvironmentVariable("AGENTARMY_DOMAIN_PACK");
        if (!parsed.TryGetValue("playbook", out var playbookId) || string.IsNullOrWhiteSpace(playbookId))
        {
            Console.Error.WriteLine("Missing --playbook");
            return 1;
        }

        var exec = Runner.BuildExecution(rootDir, parsed, domainPackId);
        var playbook = PlaybookLoader.Load(rootDir, exec.DomainPack, playbookId);

        var runId = DateTimeOffset.UtcNow.ToString("yyyyMMdd_HHmmss") + "_" + playbook.Id;
        var runDir = Path.Combine(rootDir, "runs", runId);
        await Runner.RunOneAsync(rootDir, exec, playbook, runId, runDir, ct);
        Console.WriteLine(runDir);
        return 0;
    }

    private static async Task<int> RunBundleAsync(string rootDir, string[] args, CancellationToken ct)
    {
        var parsed = Args.Parse(args);
        RiskPolicy.Enforce(parsed);
        var domainPackId = parsed.GetValueOrDefault("domainPack") ?? Environment.GetEnvironmentVariable("AGENTARMY_DOMAIN_PACK");
        var exec = Runner.BuildExecution(rootDir, parsed, domainPackId);
        if (exec.DomainPack is null)
        {
            Console.Error.WriteLine("Bundle requires a domain pack. Use --domainPack market-intel");
            return 1;
        }

        var bundleId = parsed.GetValueOrDefault("id") ?? "weekly";
        var bundle = BundleLoader.Load(rootDir, exec.DomainPack, bundleId);
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

    private static async Task<int> CeoAsync(string rootDir, string[] args, CancellationToken ct)
    {
        var parsed = Args.Parse(args);
        var domainPackId = parsed.GetValueOrDefault("domainPack") ?? Environment.GetEnvironmentVariable("AGENTARMY_DOMAIN_PACK");
        var pack = DomainPackLoader.TryLoad(rootDir, domainPackId);
        if (pack is null)
        {
            Console.Error.WriteLine("CEO requires a domain pack. Use --domainPack market-intel");
            return 1;
        }

        var request = parsed.GetValueOrDefault("request") ?? string.Empty;
        if (string.IsNullOrWhiteSpace(request))
        {
            Console.Error.WriteLine("Missing --request");
            return 1;
        }

        var exec = Runner.BuildExecution(rootDir, parsed, pack.Id);
        using var http = exec.DryRun ? null : new HttpClient();
        ILlmClient llm;
        if (exec.DryRun)
        {
            llm = new FakeLlmClient();
        }
        else
        {
            if (string.IsNullOrWhiteSpace(exec.ApiKey))
            {
                Console.Error.WriteLine("Missing OpenAI API key. Set OPENAI_API_KEY or create agentarmy.local.json");
                return 1;
            }
            llm = new OpenAiResponsesClient(http!, exec.ApiKey, exec.Model, enableWebSearch: false);
        }

        var planner = new CeoPlanner(llm);
        var plan = await planner.PlanAsync(request, answersJson: null, pack, ct);

        var ceoRunId = DateTimeOffset.UtcNow.ToString("yyyyMMdd_HHmmss") + $"_ceo_{pack.Id}";
        var ceoDir = Path.Combine(rootDir, "runs", "ceo", ceoRunId);
        Directory.CreateDirectory(ceoDir);

        var planPath = Path.Combine(ceoDir, "plan.json");
        var planJson = System.Text.Json.JsonSerializer.Serialize(plan, new System.Text.Json.JsonSerializerOptions { WriteIndented = true });
        await File.WriteAllTextAsync(planPath, planJson + "\n", Encoding.UTF8, ct);

        if (plan.ClarifyingQuestions.Count > 0)
        {
            var qPath = Path.Combine(ceoDir, "questions.md");
            var lines = new List<string> { "# Clarifying Questions", "" };
            lines.AddRange(plan.ClarifyingQuestions.Select(q => "- " + q));
            await File.WriteAllTextAsync(qPath, string.Join("\n", lines) + "\n", Encoding.UTF8, ct);

            Console.WriteLine("CEO soruları (yanıtladıkça isteği daha netleştirip tekrar çalıştırabilirsin):");
            foreach (var q in plan.ClarifyingQuestions)
            {
                Console.WriteLine("- " + q);
            }
            Console.WriteLine();
        }

        var runs = new List<object>();
        foreach (var r in plan.Runs)
        {
            var runArgs = new Dictionary<string, string>(parsed, StringComparer.OrdinalIgnoreCase)
            {
                ["domainPack"] = pack.Id,
                ["topic"] = r.Topic,
                ["risk"] = r.Risk,
                ["web"] = r.Web ? "true" : "false",
                ["contrarian"] = r.Contrarian ? "true" : "false"
            };

            RiskPolicy.Enforce(runArgs);
            var runExec = Runner.BuildExecution(rootDir, runArgs, pack.Id);

            if (r.Mode.Equals("bundle", StringComparison.OrdinalIgnoreCase))
            {
                var bundle = BundleLoader.Load(rootDir, pack, r.Id);
                runExec.Args["contrarian"] = r.Contrarian ? "true" : "false";
                var dir = await Runner.RunBundleAsync(rootDir, runExec, bundle, r.Topic, ct);
                runs.Add(new { mode = "bundle", id = r.Id, dir });
            }
            else
            {
                var playbook = PlaybookLoader.Load(rootDir, pack, r.Id);
                var runId = DateTimeOffset.UtcNow.ToString("yyyyMMdd_HHmmss") + "_" + playbook.Id;
                var runDir = Path.Combine(ceoDir, playbook.Id);
                await Runner.RunOneAsync(rootDir, runExec, playbook, runId, runDir, ct);
                runs.Add(new { mode = "playbook", id = r.Id, dir = runDir });
            }
        }

        var manifestPath = Path.Combine(ceoDir, "ceo.json");
        var manifest = System.Text.Json.JsonSerializer.Serialize(new
        {
            domainPack = pack.Id,
            request,
            model = exec.Model,
            dryRun = exec.DryRun,
            createdAt = DateTimeOffset.UtcNow,
            plan = new { plan.PrimaryTopic, plan.Subtopics, plan.Rationale },
            runs
        }, new System.Text.Json.JsonSerializerOptions { WriteIndented = true });
        await File.WriteAllTextAsync(manifestPath, manifest + "\n", Encoding.UTF8, ct);

        Console.WriteLine(ceoDir);
        return 0;
    }

    private static async Task<int> CeoIterateAsync(string rootDir, string[] args, CancellationToken ct)
    {
        var parsed = Args.Parse(args);
        var domainPackId = parsed.GetValueOrDefault("domainPack") ?? Environment.GetEnvironmentVariable("AGENTARMY_DOMAIN_PACK");
        var pack = DomainPackLoader.TryLoad(rootDir, domainPackId);
        if (pack is null)
        {
            Console.Error.WriteLine("CEO requires a domain pack. Use --domainPack market-intel");
            return 1;
        }

        var request = parsed.GetValueOrDefault("request") ?? string.Empty;
        if (string.IsNullOrWhiteSpace(request))
        {
            Console.Error.WriteLine("Missing --request");
            return 1;
        }

        var answers = parsed.GetValueOrDefault("answers") ?? string.Empty;
        if (string.IsNullOrWhiteSpace(answers))
        {
            Console.Error.WriteLine("Missing --answers (JSON string)");
            return 1;
        }

        var exec = Runner.BuildExecution(rootDir, parsed, pack.Id);
        using var http = exec.DryRun ? null : new HttpClient();
        ILlmClient llm;
        if (exec.DryRun)
        {
            llm = new FakeLlmClient();
        }
        else
        {
            if (string.IsNullOrWhiteSpace(exec.ApiKey))
            {
                Console.Error.WriteLine("Missing OpenAI API key. Set OPENAI_API_KEY or create agentarmy.local.json");
                return 1;
            }
            llm = new OpenAiResponsesClient(http!, exec.ApiKey, exec.Model, enableWebSearch: false);
        }

        var planner = new CeoPlanner(llm);
        var plan = await planner.PlanAsync(request, answers, pack, ct);

        var ceoRunId = DateTimeOffset.UtcNow.ToString("yyyyMMdd_HHmmss") + $"_ceo_iter_{pack.Id}";
        var ceoDir = Path.Combine(rootDir, "runs", "ceo", ceoRunId);
        Directory.CreateDirectory(ceoDir);

        var planPath = Path.Combine(ceoDir, "plan.json");
        var planJson = System.Text.Json.JsonSerializer.Serialize(plan, new System.Text.Json.JsonSerializerOptions { WriteIndented = true });
        await File.WriteAllTextAsync(planPath, planJson + "\n", Encoding.UTF8, ct);

        var answersPath = Path.Combine(ceoDir, "answers.json");
        await File.WriteAllTextAsync(answersPath, answers.Trim() + "\n", Encoding.UTF8, ct);

        if (plan.ClarifyingQuestions.Count > 0)
        {
            var qPath = Path.Combine(ceoDir, "questions.md");
            var lines = new List<string> { "# Clarifying Questions", "" };
            lines.AddRange(plan.ClarifyingQuestions.Select(q => "- " + q));
            await File.WriteAllTextAsync(qPath, string.Join("\n", lines) + "\n", Encoding.UTF8, ct);
        }

        var runs = new List<object>();
        foreach (var r in plan.Runs)
        {
            var runArgs = new Dictionary<string, string>(parsed, StringComparer.OrdinalIgnoreCase)
            {
                ["domainPack"] = pack.Id,
                ["topic"] = r.Topic,
                ["risk"] = r.Risk,
                ["web"] = r.Web ? "true" : "false",
                ["contrarian"] = r.Contrarian ? "true" : "false"
            };

            RiskPolicy.Enforce(runArgs);
            var runExec = Runner.BuildExecution(rootDir, runArgs, pack.Id);

            if (r.Mode.Equals("bundle", StringComparison.OrdinalIgnoreCase))
            {
                var bundle = BundleLoader.Load(rootDir, pack, r.Id);
                runExec.Args["contrarian"] = r.Contrarian ? "true" : "false";
                var dir = await Runner.RunBundleAsync(rootDir, runExec, bundle, r.Topic, ct);
                runs.Add(new { mode = "bundle", id = r.Id, dir });
            }
            else
            {
                var playbook = PlaybookLoader.Load(rootDir, pack, r.Id);
                var runId = DateTimeOffset.UtcNow.ToString("yyyyMMdd_HHmmss") + "_" + playbook.Id;
                var runDir = Path.Combine(ceoDir, playbook.Id);
                await Runner.RunOneAsync(rootDir, runExec, playbook, runId, runDir, ct);
                runs.Add(new { mode = "playbook", id = r.Id, dir = runDir });
            }
        }

        var manifestPath = Path.Combine(ceoDir, "ceo.json");
        var manifest = System.Text.Json.JsonSerializer.Serialize(new
        {
            domainPack = pack.Id,
            request,
            answers,
            model = exec.Model,
            dryRun = exec.DryRun,
            createdAt = DateTimeOffset.UtcNow,
            plan = new { plan.PrimaryTopic, plan.Subtopics, plan.Rationale },
            runs
        }, new System.Text.Json.JsonSerializerOptions { WriteIndented = true });
        await File.WriteAllTextAsync(manifestPath, manifest + "\n", Encoding.UTF8, ct);

        Console.WriteLine(ceoDir);
        return 0;
    }

    private static string[] ArgsToArray(Dictionary<string, string> args)
    {
        var list = new List<string>();
        foreach (var kv in args)
        {
            list.Add("--" + kv.Key);
            if (!string.Equals(kv.Value, "true", StringComparison.OrdinalIgnoreCase))
            {
                list.Add(kv.Value);
            }
        }
        return list.ToArray();
    }
}
