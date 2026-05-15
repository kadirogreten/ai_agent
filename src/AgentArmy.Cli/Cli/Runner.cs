using System.Text;

namespace AgentArmy.Cli;

public static class Runner
{
    public sealed class Execution
    {
        public required bool DryRun { get; init; }
        public required bool Web    { get; init; }
        public required string Model   { get; init; }
        public required string? ApiKey { get; init; }
        public required DomainPack? DomainPack { get; init; }
        public required Dictionary<string, string> Args { get; init; }
    }

    public static Execution BuildExecution(string rootDir, Dictionary<string, string> parsed, string? domainPackId)
    {
        var dryRun = (parsed.GetValueOrDefault("dryRun") ?? "false")
            .Equals("true", StringComparison.OrdinalIgnoreCase);
        var web = (parsed.GetValueOrDefault("web") ?? "false")
            .Equals("true", StringComparison.OrdinalIgnoreCase);

        var local  = LocalConfig.TryLoad(rootDir);
        var apiKey = Environment.GetEnvironmentVariable("OPENAI_API_KEY") ?? local?.OpenAI?.ApiKey;
        var model  = parsed.GetValueOrDefault("model")
                     ?? Environment.GetEnvironmentVariable("OPENAI_MODEL")
                     ?? local?.OpenAI?.Model
                     ?? "gpt-4.1";

        var domainPack = DomainPackLoader.TryLoad(rootDir, domainPackId);

        return new Execution
        {
            DryRun     = dryRun,
            Web        = web,
            Model      = model,
            ApiKey     = apiKey,
            DomainPack = domainPack,
            Args       = parsed
        };
    }

    public static TaskContract BuildContract(Execution exec, Playbook playbook)
    {
        var persona = exec.Args.GetValueOrDefault("persona") ?? playbook.DefaultPersona;
        var topic   = exec.Args.GetValueOrDefault("topic")  ?? string.Empty;
        var goal    = exec.Args.GetValueOrDefault("goal")   ?? $"{playbook.Title} üret";
        var riskArg = exec.Args.TryGetValue("risk", out var rVal) ? rVal.Trim() : null;
        var risk    = !string.IsNullOrWhiteSpace(riskArg)
            ? riskArg!
            : (!string.IsNullOrWhiteSpace(playbook.DefaultRisk) ? playbook.DefaultRisk.Trim() : "R1");

        var quality = exec.Args.GetValueOrDefault("quality")
                      ?? "Kaynaksız kritik iddia yok; belirsizlikleri işaretle.";
        if (exec.DomainPack?.Id.Equals("market-intel", StringComparison.OrdinalIgnoreCase) == true)
            quality += " Kritik iddialar URL ile kanıtlanmalı; sayısal iddialarda URL zorunlu.";
        if (exec.DomainPack?.Id.Equals("e-ticaret", StringComparison.OrdinalIgnoreCase) == true)
            quality += " E‑ticaret: yanıltıcı iddia, abartılı performans garantisi ve sahte kullanıcı yorumu içeriği yasaktır.";
        if (exec.DomainPack?.Id.Equals("hibe-yazimi", StringComparison.OrdinalIgnoreCase) == true)
            quality += " Hibe: uydurma yayın/projeksiyon yok; akademik/teşvik iddiaları doğrulanabilir URL ile.";

        var tools = exec.Args.GetValueOrDefault("tools") ?? "Yalnızca metin üretimi; dış sistemlerde aksiyon yok.";
        var contrarian = (exec.Args.GetValueOrDefault("contrarian") ?? "false")
            .Equals("true", StringComparison.OrdinalIgnoreCase);
        if (contrarian) tools += " contrarian:on";

        return new TaskContract(
            Persona:          persona,
            Goal:             goal,
            Topic:            topic,
            Deliverables:     exec.Args.GetValueOrDefault("deliverables") ?? playbook.Title,
            Scope:            exec.Args.GetValueOrDefault("scope")        ?? string.Empty,
            OutOfScope:       exec.Args.GetValueOrDefault("outOfScope")   ?? string.Empty,
            QualityCriteria:  quality,
            Risk:             risk,
            ToolPermissions:  tools,
            Deadline:         exec.Args.GetValueOrDefault("deadline")     ?? string.Empty
        );
    }

    public static async Task RunOneAsync(
        string rootDir,
        Execution exec,
        Playbook playbook,
        string runId,
        string runDir,
        LocalConfig.SupabaseConfigSection? supabase,
        CancellationToken ct)
    {
        var agentsFile = exec.Args.GetValueOrDefault("agentsFile")
                         ?? Environment.GetEnvironmentVariable("AGENTARMY_AGENTS_FILE");
        var agentOverrides = AgentsFileLoader.LoadAgents(agentsFile);

        var selectedAgentsRaw = exec.Args.GetValueOrDefault("agents")
                                ?? Environment.GetEnvironmentVariable("AGENTARMY_SELECTED_AGENTS");
        var selectedAgents = (selectedAgentsRaw ?? string.Empty)
            .Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
            .Where(s => !string.IsNullOrWhiteSpace(s))
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToArray();

        ILlmClient llm;
        ILlmClient? webLlm = null;
        HttpClient? http   = null;
        OpenAiImageClient? images = null;

        if (exec.DryRun)
        {
            llm = new FakeLlmClient();
        }
        else
        {
            if (string.IsNullOrWhiteSpace(exec.ApiKey))
                throw new InvalidOperationException("Missing OpenAI API key.");

            // Paylaşılan handler; LLM çağrıları uzun sürebilir, timeout 5dk.
            http = new HttpClient(HttpClientPool.SharedHandler, disposeHandler: false)
            {
                Timeout = TimeSpan.FromMinutes(5)
            };
            var fallbackModel = LlmRouter.ModelForCostClass("low");
            ILlmClient baseLlm = new OpenAiResponsesClient(http, exec.ApiKey, exec.Model, enableWebSearch: false);
            ILlmClient? fallbackLlm = exec.Model != fallbackModel
                ? new OpenAiResponsesClient(http, exec.ApiKey, fallbackModel, enableWebSearch: false)
                : null;
            llm    = new LlmRouter(baseLlm, exec.Model, fallbackLlm);
            images = new OpenAiImageClient(http, exec.ApiKey);

            if (exec.Web)
            {
                ILlmClient webBase = new OpenAiResponsesClient(
                    http, exec.ApiKey, exec.Model,
                    enableWebSearch: true,
                    allowedDomains: exec.DomainPack?.AllowedDomains);
                webLlm = new LlmRouter(webBase, exec.Model, fallbackLlm);
            }
        }

        using var db = SupabaseWriter.TryCreate(supabase);
        using (http)
        {
            var enableFacts = exec.DomainPack?.Id.Equals("market-intel", StringComparison.OrdinalIgnoreCase) == true
                              && !exec.DryRun
                              && (exec.Args.GetValueOrDefault("facts") ?? "true")
                                  .Equals("true", StringComparison.OrdinalIgnoreCase);

            FactsExtractor? extractor = null;
            FactsStore? store         = null;
            string? factsTopic        = null;

            if (enableFacts && db is not null)
            {
                extractor  = new FactsExtractor(llm);
                store      = new FactsStore(db, exec.DomainPack!.Id);
                factsTopic = exec.Args.GetValueOrDefault("topic") ?? string.Empty;
            }

            // Kapı 1: Hafızalı otonomi — facts'leri DB'den oku (tek hakikat kaynağı).
            FactsIndex? factsIndex = (db is not null && exec.DomainPack is not null)
                ? new FactsIndex(db, exec.DomainPack.Id)
                : null;

            // Persona: DB-first (personas tablosu) + disk fallback.
            var personaSlug = exec.Args.GetValueOrDefault("persona") ?? playbook.DefaultPersona;
            var personaText = await PersonaLoader.LoadTextAsync(
                rootDir, exec.DomainPack, personaSlug, supabase, ct);

            var orchestrator = new Orchestrator(
                llm, webLlm, rootDir,
                exec.DomainPack?.VerifierRubric,
                exec.DomainPack?.AllowedDomains,
                extractor, store, factsTopic,
                playbook.Id, runId,
                agentOverrides, images,
                factsIndex,
                personaText
            );

            var contract = BuildContract(exec, playbook);
            var ctx = new RunContext
            {
                RunId          = runId,
                RunDir         = runDir,  // images için
                Contract       = contract,
                Playbook       = playbook,
                SelectedAgents = selectedAgents,
                Db             = db
            };

            await orchestrator.RunAsync(ctx, ct);
        }
    }

    public static async Task<string> RunBundleAsync(
        string rootDir,
        Execution exec,
        Bundle bundle,
        string topic,
        LocalConfig.SupabaseConfigSection? supabase,
        CancellationToken ct)
    {
        if (exec.DomainPack is null)
            throw new InvalidOperationException("Bundle requires a domain pack.");

        var bundleRunId = DateTimeOffset.UtcNow.ToString("yyyyMMdd_HHmmss")
                          + $"_bundle_{exec.DomainPack.Id}_{bundle.Id}";

        // bundle manifest DB'ye yaz
        using var db = SupabaseWriter.TryCreate(supabase);
        if (db is not null)
        {
            await db.InsertAsync("run_outputs", new
            {
                run_id      = bundleRunId,
                output_type = "bundle_manifest",
                content_json = new
                {
                    id          = bundle.Id,
                    title       = bundle.Title,
                    domain_pack = exec.DomainPack.Id,
                    model       = exec.Model,
                    web         = exec.Web,
                    topic,
                    created_at  = DateTimeOffset.UtcNow
                }
            }, ct);
        }

        foreach (var playbookId in bundle.Playbooks)
        {
            var playbook = PlaybookLoader.Load(rootDir, exec.DomainPack, playbookId);
            var runId    = DateTimeOffset.UtcNow.ToString("yyyyMMdd_HHmmss") + "_" + playbook.Id;
            var runDir   = Path.Combine(rootDir, "runs", "bundles", bundleRunId, playbook.Id);

            exec.Args["topic"] = topic;
            await RunOneAsync(rootDir, exec, playbook, runId, runDir, supabase, ct);
        }

        return bundleRunId;
    }
}
