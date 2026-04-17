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
}

