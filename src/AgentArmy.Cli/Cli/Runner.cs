using System.Text;

namespace AgentArmy.Cli;

public static class Runner
{
    public sealed class Execution
    {
        public required bool DryRun { get; init; }
        public required bool Web { get; init; }
        public required string Model { get; init; }
        public required string? ApiKey { get; init; }
        public required DomainPack? DomainPack { get; init; }
        public required Dictionary<string, string> Args { get; init; }
    }

    public static Execution BuildExecution(string rootDir, Dictionary<string, string> parsed, string? domainPackId)
    {
        var dryRun = (parsed.GetValueOrDefault("dryRun") ?? "false").Equals("true", StringComparison.OrdinalIgnoreCase);
        var web = (parsed.GetValueOrDefault("web") ?? "false").Equals("true", StringComparison.OrdinalIgnoreCase);
        var local = LocalConfig.TryLoad(rootDir);
        var apiKey = Environment.GetEnvironmentVariable("OPENAI_API_KEY")
                     ?? local?.OpenAI?.ApiKey;
        var model = parsed.GetValueOrDefault("model")
                    ?? Environment.GetEnvironmentVariable("OPENAI_MODEL")
                    ?? local?.OpenAI?.Model
                    ?? "gpt-4.1";

        var domainPack = DomainPackLoader.TryLoad(rootDir, domainPackId);

        return new Execution
        {
            DryRun = dryRun,
            Web = web,
            Model = model,
            ApiKey = apiKey,
            DomainPack = domainPack,
            Args = parsed
        };
    }

    public static TaskContract BuildContract(Execution exec, Playbook playbook)
    {
        var persona = exec.Args.GetValueOrDefault("persona") ?? playbook.DefaultPersona;
        var topic = exec.Args.GetValueOrDefault("topic") ?? string.Empty;
        var goal = exec.Args.GetValueOrDefault("goal") ?? $"{playbook.Title} üret";
        var risk = exec.Args.GetValueOrDefault("risk") ?? "R1";

        var quality = exec.Args.GetValueOrDefault("quality") ?? "Kaynaksız kritik iddia yok; belirsizlikleri işaretle.";
        if (exec.DomainPack?.Id.Equals("market-intel", StringComparison.OrdinalIgnoreCase) == true)
        {
            quality = quality + " Kritik iddialar URL ile kanıtlanmalı; sayısal iddialarda URL zorunlu.";
        }

        return new TaskContract(
            Persona: persona,
            Goal: goal,
            Topic: topic,
            Deliverables: exec.Args.GetValueOrDefault("deliverables") ?? playbook.Title,
            Scope: exec.Args.GetValueOrDefault("scope") ?? string.Empty,
            OutOfScope: exec.Args.GetValueOrDefault("outOfScope") ?? string.Empty,
            QualityCriteria: quality,
            Risk: risk,
            ToolPermissions: exec.Args.GetValueOrDefault("tools") ?? "Yalnızca metin üretimi; dış sistemlerde aksiyon yok.",
            Deadline: exec.Args.GetValueOrDefault("deadline") ?? string.Empty
        );
    }

    public static async Task RunOneAsync(string rootDir, Execution exec, Playbook playbook, string runId, string runDir, CancellationToken ct)
    {
        ILlmClient llm;
        ILlmClient? webLlm = null;
        HttpClient? http = null;

        if (exec.DryRun)
        {
            llm = new FakeLlmClient();
        }
        else
        {
            if (string.IsNullOrWhiteSpace(exec.ApiKey))
            {
                throw new InvalidOperationException("Missing OpenAI API key. Set OPENAI_API_KEY or create agentarmy.local.json");
            }

            http = new HttpClient();
            llm = new OpenAiResponsesClient(http, exec.ApiKey, exec.Model, enableWebSearch: false);
            if (exec.Web)
            {
                webLlm = new OpenAiResponsesClient(http, exec.ApiKey, exec.Model, enableWebSearch: true, allowedDomains: exec.DomainPack?.AllowedDomains);
            }
        }

        using (http)
        {
            var enableFacts = exec.DomainPack?.Id.Equals("market-intel", StringComparison.OrdinalIgnoreCase) == true
                              && !exec.DryRun
                              && (exec.Args.GetValueOrDefault("facts") ?? "true").Equals("true", StringComparison.OrdinalIgnoreCase);

            FactsExtractor? extractor = null;
            FactsStore? store = null;
            string? factsTopic = null;

            if (enableFacts)
            {
                extractor = new FactsExtractor(llm);
                var storePath = Path.Combine(rootDir, "knowledge", "market-intel", "facts.jsonl");
                store = new FactsStore(storePath);
                factsTopic = exec.Args.GetValueOrDefault("topic") ?? string.Empty;
            }

            var orchestrator = new Orchestrator(
                llm,
                webLlm,
                rootDir,
                exec.DomainPack?.VerifierRubric,
                exec.DomainPack?.AllowedDomains,
                extractor,
                store,
                factsTopic,
                playbook.Id,
                runId
            );

            var contract = BuildContract(exec, playbook);
            var ctx = new RunContext
            {
                RunId = runId,
                RunDir = runDir,
                Contract = contract,
                Playbook = playbook
            };

            await orchestrator.RunAsync(ctx, ct);
        }
    }

    public static async Task<string> RunBundleAsync(string rootDir, Execution exec, Bundle bundle, string topic, CancellationToken ct)
    {
        if (exec.DomainPack is null)
        {
            throw new InvalidOperationException("Bundle requires a domain pack.");
        }

        var bundleRunId = DateTimeOffset.UtcNow.ToString("yyyyMMdd_HHmmss") + $"_bundle_{exec.DomainPack.Id}_{bundle.Id}";
        var bundleDir = Path.Combine(rootDir, "runs", "bundles", bundleRunId);
        Directory.CreateDirectory(bundleDir);

        var runs = new List<object>();
        foreach (var playbookId in bundle.Playbooks)
        {
            var playbook = PlaybookLoader.Load(rootDir, exec.DomainPack, playbookId);
            var runId = DateTimeOffset.UtcNow.ToString("yyyyMMdd_HHmmss") + "_" + playbook.Id;
            var runDir = Path.Combine(bundleDir, playbook.Id);

            exec.Args["topic"] = topic;
            await RunOneAsync(rootDir, exec, playbook, runId, runDir, ct);
            runs.Add(new { playbook = playbook.Id, dir = runDir });
        }

        var manifestPath = Path.Combine(bundleDir, "bundle.json");
        var manifest = System.Text.Json.JsonSerializer.Serialize(new
        {
            id = bundle.Id,
            title = bundle.Title,
            domainPack = exec.DomainPack.Id,
            model = exec.Model,
            web = exec.Web,
            topic,
            createdAt = DateTimeOffset.UtcNow,
            runs
        }, new System.Text.Json.JsonSerializerOptions { WriteIndented = true });
        await File.WriteAllTextAsync(manifestPath, manifest + "\n", Encoding.UTF8, ct);

        return bundleDir;
    }
}

