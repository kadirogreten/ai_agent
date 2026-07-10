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

    public static Execution BuildExecution(
        string rootDir,
        Dictionary<string, string> parsed,
        string? domainPackId,
        DomainPack? preloadedPack = null)
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

        // DB'den önceden yüklenmiş pack'i kullan — dosya sistemine bakılmaz.
        var domainPack = preloadedPack;

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

        // D2c: canary pack — risk tabanı (ilk N production koşum min R2)
        if (exec.DomainPack is { IsCanary: true, CanaryRemaining: > 0 })
        {
            var floor = exec.DomainPack.CanaryRiskFloor;
            if (LlmProviderResolver.RiskLevel(risk) < LlmProviderResolver.RiskLevel(floor))
                risk = floor;
        }

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
        // Agent'ları DB'den yükle — dosya tabanlı yaklaşım kaldırıldı.
        IReadOnlyDictionary<string, Agent> agentOverrides =
            new Dictionary<string, Agent>(StringComparer.OrdinalIgnoreCase);
        if (supabase?.IsConfigured == true)
        {
            try
            {
                agentOverrides = await DomainPackDbLoader.LoadAgentsAsync(supabase, ct);
            }
            catch (Exception ex)
            {
                Console.Error.WriteLine($"[Runner] DB'den agent yüklenemedi: {ex.Message}");
            }
        }

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
        LlmProviderRecord? provider = null;

        // PR10: DB erken açılıyor — provider çözümleme için (DryRun'da da null-safe).
        using var db = SupabaseWriter.TryCreate(supabase);

        if (exec.DryRun)
        {
            llm = new FakeLlmClient();
        }
        else
        {
            // PR10: DB-first provider çözümleme.
            // --model CLI argümanı verilmişse exec.Args'tan gelir ve geriye uyumluluk korunur (BuildExecution).
            // Verilmemişse DB'den is_default_for='run' kaydı çözümlenir.
            var cliModelOverride = exec.Args.GetValueOrDefault("model");
            if (!string.IsNullOrWhiteSpace(cliModelOverride))
            {
                // Geriye uyumluluk: --model verilmiş, fallback provider record yap.
                provider = LlmProviderResolver.Fallback with { ModelId = cliModelOverride };
                Console.Error.WriteLine($"[LlmProvider] run: CLI override ({cliModelOverride})");
            }
            else
            {
                provider = await LlmProviderResolver.ResolveAsync(db, "run", ct);
            }

            // Paylaşılan handler; LLM çağrıları uzun sürebilir, timeout 5dk.
            http = new HttpClient(HttpClientPool.SharedHandler, disposeHandler: false)
            {
                Timeout = TimeSpan.FromMinutes(5)
            };

            ILlmClient baseLlm = LlmClientFactory.Create(http, provider, enableWebSearch: false);
            var fallbackProvider = LlmProviderResolver.Fallback with
            {
                ModelId   = LlmRouter.ModelForCostClass("low"),
                ApiKeyEnv = provider.ApiKeyEnv,
            };
            ILlmClient? fallbackLlm = provider.ModelId != fallbackProvider.ModelId
                ? LlmClientFactory.Create(
                    new HttpClient(HttpClientPool.SharedHandler, disposeHandler: false) { Timeout = TimeSpan.FromMinutes(5) },
                    fallbackProvider, enableWebSearch: false)
                : null;
            llm    = new LlmRouter(baseLlm, provider.ModelId, fallbackLlm);
            images = new OpenAiImageClient(http, Environment.GetEnvironmentVariable(provider.ApiKeyEnv) ?? "");

            if (exec.Web)
            {
                ILlmClient webBase = LlmClientFactory.Create(
                    new HttpClient(HttpClientPool.SharedHandler, disposeHandler: false) { Timeout = TimeSpan.FromMinutes(5) },
                    provider, enableWebSearch: true);
                webLlm = new LlmRouter(webBase, provider.ModelId, fallbackLlm);
            }
        }
        using (http)
        {
            // enableFacts:
            //   - Operasyona bağlı run'larda (OperationId dolu) her zaman açık — kapalı döngü belleği için şart.
            //   - Bağımsız run'larda eski davranış korunur (market-intel kilidi + --facts flag).
            var operationId = Environment.GetEnvironmentVariable("RUN_OPERATION_ID");
            var hasOperation = !string.IsNullOrWhiteSpace(operationId);

            var enableFacts = !exec.DryRun && (
                hasOperation
                || (exec.DomainPack?.Id.Equals("market-intel", StringComparison.OrdinalIgnoreCase) == true
                    && (exec.Args.GetValueOrDefault("facts") ?? "true")
                           .Equals("true", StringComparison.OrdinalIgnoreCase)));

            FactsExtractor? extractor = null;
            FactsStore? store         = null;
            EmbeddingService? embeddingService = null;
            string? factsTopic        = null;

            if (enableFacts && db is not null)
            {
                if (http is not null)
                    embeddingService = new EmbeddingService(http);
                extractor  = new FactsExtractor(llm);
                store      = new FactsStore(db, exec.DomainPack?.Id ?? "default", embeddingService);
                factsTopic = exec.Args.GetValueOrDefault("topic") ?? string.Empty;
            }

            // Kapı 1: Hafızalı otonomi — facts'leri DB'den oku (tek hakikat kaynağı).
            FactsIndex? factsIndex = (db is not null && exec.DomainPack is not null)
                ? new FactsIndex(db, exec.DomainPack.Id, embeddingService)
                : null;

            // Operasyon belleği: operationId varsa run'lar arası kalıcı durum.
            OperationMemoryStore? opMemStore = (hasOperation && db is not null)
                ? new OperationMemoryStore(db, operationId!, runId)
                : null;

            // Persona: DB-first profil (behaviors + risk_ceiling overlay) + disk fallback.
            var personaSlug = exec.Args.GetValueOrDefault("persona") ?? playbook.DefaultPersona;
            var personaProfile = await PersonaLoader.LoadProfileAsync(
                rootDir, exec.DomainPack, personaSlug, supabase, ct);

            StepLlmResolver? stepLlm = null;
            if (!exec.DryRun && http is not null)
                stepLlm = new StepLlmResolver(db, llm);

            var orchestrator = new Orchestrator(
                llm, webLlm, rootDir,
                exec.DomainPack?.VerifierRubric,
                exec.DomainPack?.AllowedDomains,
                extractor, store, factsTopic,
                playbook.Id, runId,
                agentOverrides, images,
                factsIndex,
                personaProfile,
                db is not null
                    ? await ToolExecutor.CreateWithDbAsync(db, ct)
                    : ToolExecutor.CreateDefault(),
                compensator: null,
                opMemStore:  opMemStore,
                stepLlm:     stepLlm,
                toolRanker:  db is not null && embeddingService is not null
                    ? new ToolRanker(db, embeddingService)
                    : null
            );

            // tools.enabled haritasını run başında yükle.
            // 1. Platform araçları (tenant_id IS NULL) → platform varsayılanı
            // 2. tool_overrides (owner_user_id = ownerId) → kullanıcı override'ı kazanır
            // tools_update RLS artık platform satırlarını authenticated'a kapattı (PR8 migration).
            IReadOnlyDictionary<string, bool>? toolEnabledMap = null;
            if (db is not null)
            {
                var ownerId = Environment.GetEnvironmentVariable("RUN_OWNER_USER_ID");
                try
                {
                    var map = new Dictionary<string, bool>(StringComparer.OrdinalIgnoreCase);

                    // 1) Platform araçları
                    var toolsJson = await db.SelectAsync("tools", "select=slug,enabled&tenant_id=is.null", ct);
                    if (toolsJson.ValueKind == System.Text.Json.JsonValueKind.Array)
                    {
                        foreach (var row in toolsJson.EnumerateArray())
                        {
                            if (!row.TryGetProperty("slug", out var slugEl)) continue;
                            var slug = slugEl.GetString();
                            if (string.IsNullOrWhiteSpace(slug)) continue;
                            map[slug] = !row.TryGetProperty("enabled", out var enEl) || enEl.GetBoolean();
                        }
                    }

                    // 2) Kullanıcı override'ları — platform değerinin üzerine yazar
                    if (!string.IsNullOrWhiteSpace(ownerId))
                    {
                        var overridesJson = await db.SelectAsync("tool_overrides",
                            $"select=tool_slug,enabled&owner_user_id=eq.{Uri.EscapeDataString(ownerId)}", ct);
                        if (overridesJson.ValueKind == System.Text.Json.JsonValueKind.Array)
                        {
                            foreach (var row in overridesJson.EnumerateArray())
                            {
                                if (!row.TryGetProperty("tool_slug", out var slugEl)) continue;
                                var slug = slugEl.GetString();
                                if (string.IsNullOrWhiteSpace(slug)) continue;
                                map[slug] = row.TryGetProperty("enabled", out var enEl) && enEl.GetBoolean();
                            }
                        }
                    }

                    toolEnabledMap = map;
                }
                catch (Exception ex)
                {
                    Console.Error.WriteLine($"[Runner] tools.enabled haritası yüklenemedi: {ex.Message}");
                }
            }

            // PR9: RUN_INTENT_JSON env'inden intent sözleşmesini parse et.
            IReadOnlySet<string>? intentForbiddenTools = null;
            decimal? intentSpendCap = null;
            var intentJsonRaw = Environment.GetEnvironmentVariable("RUN_INTENT_JSON");
            if (!string.IsNullOrWhiteSpace(intentJsonRaw))
            {
                try
                {
                    using var intentDoc = System.Text.Json.JsonDocument.Parse(intentJsonRaw);
                    var root = intentDoc.RootElement;

                    if (root.TryGetProperty("forbidden_tools", out var ft) &&
                        ft.ValueKind == System.Text.Json.JsonValueKind.Array)
                    {
                        var set = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
                        foreach (var item in ft.EnumerateArray())
                            if (item.ValueKind == System.Text.Json.JsonValueKind.String)
                                set.Add(item.GetString()!);
                        intentForbiddenTools = set;
                    }

                    if (root.TryGetProperty("max_total_spend", out var mts) &&
                        mts.ValueKind == System.Text.Json.JsonValueKind.Number)
                    {
                        intentSpendCap = mts.GetDecimal();
                    }
                }
                catch (Exception ex)
                {
                    // Env var varsa ama bozuksa fail-closed: kötü niyetli manipülasyona açık kapı bırakma.
                    throw new InvalidOperationException($"intent sözleşmesi okunamadı: {ex.Message}", ex);
                }
            }

            var contract = BuildContract(exec, playbook);

            // PR10: Tier kontrolü — run risk'i provider max_decision_risk'ini aşarsa reddet.
            // provider değişkeni yukarıda (using (http) öncesinde) çözümlendi; DryRun'da skip.
            if (!exec.DryRun && provider is not null &&
                LlmProviderResolver.RiskLevel(contract.Risk) > LlmProviderResolver.RiskLevel(provider.MaxDecisionRisk))
                throw new InvalidOperationException(
                    $"[Runner] model tier yetersiz: {provider.Slug} max={provider.MaxDecisionRisk} < run risk={contract.Risk}");

            var ctx = new RunContext
            {
                RunId                = runId,
                RunDir               = runDir,  // images için
                Contract             = contract,
                Playbook             = playbook,
                SelectedAgents       = selectedAgents,
                Db                   = db,
                ToolEnabledMap       = toolEnabledMap,
                IntentForbiddenTools = intentForbiddenTools,
                IntentSpendCap       = intentSpendCap,
            };

            await orchestrator.RunAsync(ctx, ct);

            // Sector Discovery hook: doğrudan playbook çalıştırması (CEO mode değil) için
            // de scaffold çıktısını domain_pack_drafts tablosuna yaz. Aksi halde portal
            // "Taslaklar" sekmesinde hiçbir şey görünmez.
            // PR14: "sector-" prefix'li tüm playbook'lar hook'u tetikler (sector-paket-taslak dahil).
            if (db is not null
                && playbook.Id.StartsWith("sector-", StringComparison.OrdinalIgnoreCase))
            {
                try
                {
                    var topic     = exec.Args.GetValueOrDefault("topic") ?? string.Empty;
                    var runReqId  = Environment.GetEnvironmentVariable("RUN_REQUEST_ID");
                    var draftId   = await DomainPackDraftWriter.TryWriteFromDbAsync(
                        db, runId, topic, runReqId, ct);
                    if (!string.IsNullOrWhiteSpace(draftId))
                        Console.WriteLine($"[Runner] Sector discovery draft yazıldı: {draftId}");
                    else
                        Console.Error.WriteLine("[Runner] Sector discovery draft yazılamadı (scaffold step çıktısı boş veya parse hatası).");
                }
                catch (Exception ex)
                {
                    Console.Error.WriteLine($"[Runner] DraftWriter hatası: {ex.Message}");
                }
            }
        }
    }

    public sealed record BundleRunResult(string BundleRunId, IReadOnlyList<string> PlaybookRunIds);

    public static async Task<BundleRunResult> RunBundleAsync(
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
        var ownerUserId = Environment.GetEnvironmentVariable("RUN_OWNER_USER_ID");
        var playbookRunIds = new List<string>();

        // bundle manifest DB'ye yaz
        using var db = SupabaseWriter.TryCreate(supabase);
        if (db is not null)
        {
            await db.InsertAsync("run_outputs", new
            {
                run_id         = bundleRunId,
                owner_user_id  = string.IsNullOrWhiteSpace(ownerUserId) ? null : ownerUserId,
                output_type    = "bundle_manifest",
                content_json   = new
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
            var playbook = await PlaybookLoader.LoadAsync(rootDir, exec.DomainPack, playbookId, supabase, ct);
            var runId    = DateTimeOffset.UtcNow.ToString("yyyyMMdd_HHmmss") + "_" + playbook.Id;
            playbookRunIds.Add(runId);
            var runDir   = Path.Combine(rootDir, "runs", "bundles", bundleRunId, playbook.Id);

            exec.Args["topic"] = topic;
            await RunOneAsync(rootDir, exec, playbook, runId, runDir, supabase, ct);
        }

        return new BundleRunResult(bundleRunId, playbookRunIds);
    }
}
