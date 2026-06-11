using System.Text;
using System.Text.Json;

namespace AgentArmy.Cli;

public sealed class Orchestrator
{
    private readonly ILlmClient _llm;
    private readonly ILlmClient? _webLlm;
    private readonly string _rootDir;
    private readonly string? _verifierRubric;
    private readonly IReadOnlyList<string> _preferredDomains;
    private readonly FactsExtractor? _factsExtractor;
    private readonly FactsStore? _globalFactsStore;
    private readonly string? _factsTopic;
    private readonly string? _playbookId;
    private readonly string? _runId;
    private readonly IReadOnlyDictionary<string, Agent> _agents;
    private readonly OpenAiImageClient? _images;
    private readonly FactsIndex? _factsIndex;
    private readonly PersonaProfile _personaProfile;
    private readonly IToolExecutor? _toolExecutor;
    private readonly CompensationExecutor? _compensator;
    private readonly OperationMemoryStore? _opMemStore;

    // Context budget — sliding window. ~16K char ≈ ~4K token (mixed TR/EN).
    private const int MaxContextChars    = 16000;
    private const int MaxPriorFacts      = 8;
    private int _maxOperationMemory = 30; // policy_settings'ten güncellenir; varsayılan: 30

    public Orchestrator(
        ILlmClient llm,
        ILlmClient? webLlm,
        string rootDir,
        string? verifierRubric,
        IReadOnlyList<string>? preferredDomains,
        FactsExtractor? factsExtractor,
        FactsStore? globalFactsStore,
        string? factsTopic,
        string? playbookId,
        string? runId,
        IReadOnlyDictionary<string, Agent>? agentOverrides,
        OpenAiImageClient? images,
        FactsIndex? factsIndex = null,
        PersonaProfile? personaProfile = null,
        IToolExecutor? toolExecutor = null,
        CompensationExecutor? compensator = null,
        OperationMemoryStore? opMemStore = null
    )
    {
        _llm              = llm;
        _webLlm           = webLlm;
        _rootDir          = rootDir;
        _verifierRubric   = verifierRubric;
        _preferredDomains = preferredDomains ?? Array.Empty<string>();
        _factsExtractor   = factsExtractor;
        _globalFactsStore = globalFactsStore;
        _factsTopic       = factsTopic;
        _playbookId       = playbookId;
        _runId            = runId;
        _images               = images;
        _factsIndex           = factsIndex;
        _personaProfile       = personaProfile ?? PersonaProfile.FromMarkdownOnly("default", string.Empty);
        _toolExecutor         = toolExecutor;
        _compensator          = compensator;
        _opMemStore           = opMemStore;

        var merged = new Dictionary<string, Agent>(AgentsCatalog.All, StringComparer.OrdinalIgnoreCase);
        if (agentOverrides is not null)
        {
            foreach (var kv in agentOverrides)
            {
                var ov = kv.Value;
                // DB override'ı, kataloğun KOD-tanımlı araç yeteneğini (CanUseTools) sessizce
                // kaybetmesin. Katalogda bu ajan CanUseTools=true ise (örn. Operator/Verifier)
                // override'da da koru — aksi halde araçlar hiç sunulmaz.
                if (merged.TryGetValue(kv.Key, out var core)
                    && core.Behaviors.CanUseTools
                    && !ov.Behaviors.CanUseTools)
                {
                    ov = ov with { Behaviors = ov.Behaviors with { CanUseTools = true } };
                }
                merged[kv.Key] = ov;
            }
        }
        _agents = merged;
    }

    public async Task RunAsync(RunContext ctx, CancellationToken ct)
    {
        // image dosyaları için RunDir'i oluştur (varsa)
        if (!string.IsNullOrWhiteSpace(ctx.RunDir))
            Directory.CreateDirectory(ctx.RunDir);

        // policy_settings'ten yapılandırma yükle (DB yoksa sabit değerler kullanılır)
        _maxOperationMemory = await PolicyReader.GetAsync(ctx.Db, ctx.OwnerId, "memory.max_entries", 30, ct);

        var personaText = _personaProfile.ContextMarkdown;
        if (string.IsNullOrWhiteSpace(personaText))
            personaText = LoadPersonaText(ctx.Contract.Persona, ctx.Playbook.DefaultPersona);

        RiskPolicy.EnforceTaskRiskAgainstPersonaCeiling(ctx.Contract.Risk, _personaProfile);

        // Kapı 1: Hafızalı otonomi — geçmiş run'lardaki facts'leri DB'den bir kere yükle, prompt'a inject et.
        var priorFactsText = await BuildPriorFactsBlockAsync(ctx.Contract.Topic, ct);
        if (!string.IsNullOrWhiteSpace(priorFactsText))
        {
            await ctx.AppendLogAsync(new
            {
                type        = "facts_injected",
                ts          = DateTimeOffset.UtcNow,
                runId       = ctx.RunId,
                playbook    = ctx.Playbook.Id,
                facts_count = priorFactsText.Split('\n').Count(l => l.StartsWith("- "))
            }, ct);
        }

        // Operasyon belleği: operation_id dolu ise önceki run'lardan taşınan kararları yükle.
        // Dry-run modunda da çalışır — stderr'e log edilir (bitti kriteri).
        var opMemoryText = await BuildOperationMemoryBlockAsync(ct);
        if (!string.IsNullOrWhiteSpace(opMemoryText))
        {
            Console.Error.WriteLine($"[Orchestrator] Operasyon belleği yüklendi ({opMemoryText.Split('\n').Length} satır).");
            await ctx.AppendLogAsync(new
            {
                type         = "operation_memory_injected",
                ts           = DateTimeOffset.UtcNow,
                operationId  = ctx.OperationId,
                lines        = opMemoryText.Split('\n').Length
            }, ct);
        }

        string priorWork = string.Empty;
        string verifierReport = string.Empty;

        var runStarted     = DateTimeOffset.UtcNow;
        int totalTokensIn  = 0;
        int totalTokensOut = 0;
        string? lastModel  = null;
        string? verifierOutcome = null;

        var steps = ctx.Playbook.Steps;
        if (ctx.SelectedAgents.Count > 0)
        {
            var allowed = new HashSet<string>(ctx.SelectedAgents, StringComparer.OrdinalIgnoreCase);
            steps = ctx.Playbook.Steps.Where(s => allowed.Contains(s.Agent)).ToList();
        }

        foreach (var step in steps)
        {
            // Güvenlik kilidi 1: blockOnVerifierFail.
            // Bu adım başlamadan önce önceki Verifier sonucu FAIL ise adımı çalıştırma.
            // Blok aksiyonu ÖNLER — adım hiç çalışmaz, bu adıma ait yan etkili çağrı üretilmez.
            // Dolayısıyla önceki adımların tamamlanmış çağrıları için compensation tetiklenmez;
            // yalnız adım kendisi exception ile yarıda kesilirse mevcut PR1 davranışı geçerlidir.
            if (step.BlockOnVerifierFail && IsFail(verifierReport))
            {
                Console.Error.WriteLine(
                    $"[Orchestrator] step '{step.Id}' blockOnVerifierFail=true + Verifier=FAIL → bloklandı.");

                await ctx.AppendLogAsync(new
                {
                    type     = "step_blocked_by_verifier",
                    ts       = DateTimeOffset.UtcNow,
                    runId    = ctx.RunId,
                    playbook = ctx.Playbook.Id,
                    step     = step.Id,
                    agent    = step.Agent,
                }, ct);

                if (ctx.Db is not null && ctx.OwnerId is not null)
                {
                    try
                    {
                        await ctx.Db.CallRpcAsync("append_audit_log", new
                        {
                            p_owner_user_id = ctx.OwnerId,
                            p_actor_type    = "system",
                            p_actor_id      = "orchestrator",
                            p_action        = "step.blocked_by_verifier",
                            p_resource_type = "playbook_step",
                            p_risk_level    = ctx.Contract.Risk,
                            p_severity      = "warn",
                            p_detail        = new
                            {
                                playbook    = ctx.Playbook.Id,
                                step        = step.Id,
                                agent       = step.Agent,
                                verifier_report_tail = verifierReport.Length > 200
                                    ? verifierReport[^200..] : verifierReport,
                            },
                        }, ct);
                    }
                    catch (Exception ex)
                    {
                        Console.Error.WriteLine($"[Orchestrator] blocked_by_verifier audit yazılamadı: {ex.Message}");
                    }
                }

                // Run'ı "blocked_by_verifier" ile işaretliyoruz; döngüden çıkıyoruz.
                verifierOutcome = "blocked_by_verifier";
                break;
            }

            var coreAgent   = ResolveAgent(step.Agent);
            var agent       = AgentBehaviorMerge.Apply(coreAgent, _personaProfile);
            var extraPolicy = BuildExtraPolicy(agent);
            var system      = PromptBuilder.BuildSystemPrompt(agent, personaText, extraPolicy, opMemoryText);

            var rawContext = agent.Behaviors.RequiresFullContext ? ctx.GetWork() : priorWork;
            var context    = TrimContext(rawContext);
            var user       = PromptBuilder.BuildUserPrompt(ctx, step, context, priorFactsText);

            var llm = agent.Behaviors.RequiresWebSearch ? _webLlm ?? _llm : _llm;

            await ctx.AppendLogAsync(new
            {
                type     = "step_start",
                ts       = DateTimeOffset.UtcNow,
                runId    = ctx.RunId,
                playbook = ctx.Playbook.Id,
                step     = step.Id,
                agent    = agent.Id
            }, ct);

            var (output, stepTokensIn, stepTokensOut, stepModel) =
                await RunStepCompletionAsync(llm, system, user, agent, ctx, ct);

            totalTokensIn  += stepTokensIn;
            totalTokensOut += stepTokensOut;
            lastModel = stepModel;

            await ctx.AppendLogAsync(new
            {
                type       = "step_end",
                ts         = DateTimeOffset.UtcNow,
                runId      = ctx.RunId,
                playbook   = ctx.Playbook.Id,
                step       = step.Id,
                agent      = agent.Id,
                tokens_in  = stepTokensIn,
                tokens_out = stepTokensOut,
                model      = stepModel
            }, ct);

            // Adım çıktısını DB'ye yaz
            await WriteOutputAsync(ctx, "step", step.Id, agent.Id, artifactName: null, output, ct);
            ctx.AppendWork($"{step.Id} ({agent.DisplayName})", output);

            if (!string.IsNullOrWhiteSpace(step.SaveAs))
            {
                var safeName = SafeArtifactFileName(step.SaveAs);
                await WriteOutputAsync(ctx, "artifact", step.Id, agent.Id, safeName, output, ct);
                await ctx.AppendLogAsync(new
                {
                    type     = "artifact_written",
                    ts       = DateTimeOffset.UtcNow,
                    runId    = ctx.RunId,
                    playbook = ctx.Playbook.Id,
                    step     = step.Id,
                    artifact = safeName
                }, ct);
            }

            if (step.Image is not null)
                await TryGenerateImageAsync(ctx, step, output, ct);

            if (agent.Behaviors.WritesToFacts)
                ctx.AppendFacts(step.Id, output);

            if (agent.Behaviors.WritesToDecisions)
                ctx.AppendDecisions(step.Id, output);

            if (agent.Behaviors.CapturesVerifierReport)
            {
                verifierReport  = output;
                verifierOutcome = IsFail(verifierReport) ? "fail" : "pass";
            }

            priorWork = output;

            if (ShouldRunContrarian(ctx, agent))
                await RunExtraStepAsync(ctx, new PlaybookStep
                {
                    Id     = "contrarian",
                    Agent  = "Contrarian",
                    Goal   = "Mevcut bulgular ve iddialar içindeki zayıf noktaları, eksik kanıtları ve alternatif açıklamaları çıkar.",
                    Output = "Markdown: Riskli iddialar, Eksik kaynaklar, Alternatif açıklamalar, Güçlendirme önerileri"
                }, personaText, ct);

            if (agent.Behaviors.CapturesVerifierReport && IsFail(verifierReport))
            {
                var writeStep = ctx.Playbook.Steps.FirstOrDefault(s => s.Agent.Equals("Writer", StringComparison.OrdinalIgnoreCase));
                if (writeStep is not null)
                {
                    var writer    = AgentBehaviorMerge.Apply(ResolveAgent("Writer"), _personaProfile);
                    var fixSystem = PromptBuilder.BuildSystemPrompt(writer, personaText, extraPolicy: null);
                    var fixUser   = BuildFixPrompt(ctx, writeStep, verifierReport);
                    var fixResult = await _llm.CompleteAsync(fixSystem, fixUser, ct);
                    totalTokensIn  += fixResult.TokensIn;
                    totalTokensOut += fixResult.TokensOut;
                    var revised = fixResult.Text;
                    await WriteOutputAsync(ctx, "revised", writeStep.Id, writer.Id, artifactName: null, revised, ct);
                    ctx.AppendWork($"write.revised ({writer.DisplayName})", revised);
                    priorWork = revised;
                }
            }
        }

        await TryExtractAndStoreFactsAsync(ctx, ct);
        await TryWriteOperationMemoryAsync(ctx, ct);

        // Metrikler — sadece event log'a
        var latencyMs = (int)(DateTimeOffset.UtcNow - runStarted).TotalMilliseconds;
        await ctx.AppendLogAsync(new
        {
            type             = "run_metrics",
            ts               = DateTimeOffset.UtcNow,
            runId            = ctx.RunId,
            model            = lastModel,
            tokens_in        = totalTokensIn,
            tokens_out       = totalTokensOut,
            latency_ms       = latencyMs,
            verifier_outcome = verifierOutcome
        }, ct);

        // Report → DB
        await WriteReportAsync(ctx, lastModel, totalTokensIn, totalTokensOut, latencyMs, verifierOutcome, ct);
    }

    // ── Yardımcılar ──────────────────────────────────────────────────────────

    /// <summary>
    /// Bir adımın LLM tamamlamasını üretir. Ajan araç kullanabiliyorsa (<c>CanUseTools</c>) ve
    /// görev sözleşmesinde izinli araç varsa, araç-çağrı döngüsünü çalıştırır
    /// (çağrı → yürüt → sonucu geri besle); aksi halde düz tek-atış <c>CompleteAsync</c>.
    /// Token ve model toplamlarını da döndürür. Faz A — Tool Invocation (PR4).
    /// </summary>
    private async Task<(string Text, int TokensIn, int TokensOut, string Model)> RunStepCompletionAsync(
        ILlmClient llm, string system, string user, Agent agent, RunContext ctx, CancellationToken ct)
    {
        var toolset = (_toolExecutor is not null && agent.Behaviors.CanUseTools)
            ? _toolExecutor.AvailableFor(agent, ctx.Contract)
            : (IReadOnlyList<ToolDescriptor>)Array.Empty<ToolDescriptor>();

        // Teşhis: bu adımda kaç araç sunuldu? (ajan + CanUseTools + görev izni kesişimi)
        Console.Error.WriteLine(
            $"[Orchestrator] step agent={agent.Id} canUseTools={agent.Behaviors.CanUseTools} " +
            $"toolExecutor={(_toolExecutor is not null)} offeredTools={toolset.Count}" +
            (toolset.Count > 0 ? $" [{string.Join(",", toolset.Select(t => t.Slug))}]" : ""));

        // Araç yoksa mevcut davranış birebir korunur (geriye uyumlu).
        if (toolset.Count == 0)
        {
            var r = await llm.CompleteAsync(system, user, ct);
            return (r.Text, r.TokensIn, r.TokensOut, r.Model);
        }

        var maxCalls  = ToolPermissions.Parse(ctx.Contract.ToolPermissions).MaxCalls;
        var exchanges = new List<ToolExchange>();
        int tin = 0, tout = 0;
        var model = string.Empty;

        try
        {
            for (var round = 0; round < maxCalls; round++)
            {
                var turn = await llm.CompleteWithToolsAsync(system, user, toolset, exchanges, ct);
                tin += turn.TokensIn; tout += turn.TokensOut; model = turn.Model;

                if (!turn.HasToolCalls)
                    return (turn.Text ?? string.Empty, tin, tout, model);

                // Araçları yürüt (executor: izin + RiskGate + audit) ve sonucu döngüye geri besle.
                foreach (var call in turn.ToolCalls)
                {
                    var res = await _toolExecutor!.ExecuteAsync(call.Slug, call.Args, agent, ctx, ct);
                    exchanges.Add(new ToolExchange(call, res));
                }
            }

            // Çağrı bütçesi (max_calls) doldu → araçsız son tur ile modeli nihai metne zorla.
            var final = await llm.CompleteWithToolsAsync(system, user, Array.Empty<ToolDescriptor>(), exchanges, ct);
            tin += final.TokensIn; tout += final.TokensOut; model = final.Model;
            return (final.Text ?? string.Empty, tin, tout, model);
        }
        catch (OperationCanceledException)
        {
            throw; // Gerçek iptal — yukarı taşı, kompensasyon yok.
        }
        catch
        {
            // Adım exception/abort: o ana kadar başarılı olan yan etkili çağrıları geri al.
            // Verifier FAIL'de değil, yalnız exception durumunda tetiklenir (PR2 blockOnVerifierFail bekleniyor).
            if (_compensator is not null && exchanges.Count > 0)
            {
                await _compensator.CompensateExchangesAsync(
                    exchanges, ctx.Db, ctx.OwnerId, ctx.RunId, agent.Id, ct);
            }
            throw;
        }
    }

    private static async Task WriteOutputAsync(
        RunContext ctx,
        string outputType,
        string? stepId,
        string? agentId,
        string? artifactName,
        string content,
        CancellationToken ct)
    {
        if (ctx.Db is null) return;
        await ctx.Db.InsertAsync("run_outputs", new
        {
            run_id        = ctx.RunId,
            owner_user_id = ctx.OwnerId,
            step_id       = stepId,
            agent_id      = agentId,
            artifact_name = artifactName,
            output_type   = outputType,
            content_md    = content.Trim()
        }, ct);
    }

    private async Task WriteReportAsync(
        RunContext ctx,
        string? model,
        int tokensIn,
        int tokensOut,
        int latencyMs,
        string? verifierOutcome,
        CancellationToken ct)
    {
        if (ctx.Db is null) return;

        var report = new
        {
            run_id           = ctx.RunId,
            playbook         = new { id = ctx.Playbook.Id, title = ctx.Playbook.Title },
            contract         = ctx.Contract,
            selected_agents  = ctx.SelectedAgents,
            model,
            tokens_in        = tokensIn,
            tokens_out       = tokensOut,
            latency_ms       = latencyMs,
            verifier_outcome = verifierOutcome,
            generated_at     = DateTimeOffset.UtcNow,
            work             = ctx.GetWork(),
            facts            = ctx.GetFacts(),
            decisions        = ctx.GetDecisions()
        };

        await ctx.Db.InsertAsync("run_outputs", new
        {
            run_id        = ctx.RunId,
            owner_user_id = ctx.OwnerId,
            output_type   = "report",
            content_json  = JsonSerializer.Deserialize<JsonElement>(
                JsonSerializer.Serialize(report,
                    new JsonSerializerOptions { PropertyNamingPolicy = JsonNamingPolicy.SnakeCaseLower }))
        }, ct);

        await ctx.AppendLogAsync(new
        {
            type     = "report_written",
            ts       = DateTimeOffset.UtcNow,
            runId    = ctx.RunId,
            playbook = ctx.Playbook.Id
        }, ct);
    }

    private async Task TryGenerateImageAsync(RunContext ctx, PlaybookStep step, string prompt, CancellationToken ct)
    {
        if (_images is null || string.IsNullOrWhiteSpace(prompt)) return;

        var size = string.IsNullOrWhiteSpace(step.Image?.Size) ? "1024x1024" : step.Image!.Size!.Trim();
        var fileNameBase = string.IsNullOrWhiteSpace(step.Image?.FileName)
            ? $"{step.Id}.image.png"
            : step.Image!.FileName!.Trim();
        var fileName = fileNameBase.EndsWith(".png", StringComparison.OrdinalIgnoreCase)
            ? fileNameBase
            : fileNameBase + ".png";

        var bytes = await _images.GeneratePngAsync(prompt.Trim(), size, ct);

        // Image binary'i diskteki RunDir'e yaz (binary blob DB'ye uygun değil)
        if (!string.IsNullOrWhiteSpace(ctx.RunDir))
        {
            var path = Path.Combine(ctx.RunDir, fileName);
            await File.WriteAllBytesAsync(path, bytes, ct);
        }

        await WriteOutputAsync(ctx, "image_ref", step.Id, null, fileName, $"size={size}", ct);
        await ctx.AppendLogAsync(new
        {
            type     = "image_generated",
            ts       = DateTimeOffset.UtcNow,
            runId    = ctx.RunId,
            playbook = ctx.Playbook.Id,
            step     = step.Id,
            file     = fileName,
            size
        }, ct);
    }

    private bool ShouldRunContrarian(RunContext ctx, Agent agent)
    {
        var enabled = (ctx.Contract.ToolPermissions ?? string.Empty)
            .Contains("contrarian:on", StringComparison.OrdinalIgnoreCase);
        return enabled && agent.Behaviors.TriggersContrarian;
    }

    private async Task RunExtraStepAsync(RunContext ctx, PlaybookStep step, string personaText, CancellationToken ct)
    {
        var agent       = AgentBehaviorMerge.Apply(ResolveAgent(step.Agent), _personaProfile);
        var extraPolicy = BuildExtraPolicy(agent);
        var opMem       = await BuildOperationMemoryBlockAsync(ct);
        var system      = PromptBuilder.BuildSystemPrompt(agent, personaText, extraPolicy, opMem);
        var context     = TrimContext(ctx.GetWork());
        var priorFacts  = await BuildPriorFactsBlockAsync(ctx.Contract.Topic, ct);
        var user        = PromptBuilder.BuildUserPrompt(ctx, step, context, priorFacts);

        await ctx.AppendLogAsync(new
        {
            type     = "step_start",
            ts       = DateTimeOffset.UtcNow,
            runId    = ctx.RunId,
            playbook = ctx.Playbook.Id,
            step     = step.Id,
            agent    = agent.Id
        }, ct);

        var result = await _llm.CompleteAsync(system, user, ct);
        var output = result.Text;

        await ctx.AppendLogAsync(new
        {
            type       = "step_end",
            ts         = DateTimeOffset.UtcNow,
            runId      = ctx.RunId,
            playbook   = ctx.Playbook.Id,
            step       = step.Id,
            agent      = agent.Id,
            tokens_in  = result.TokensIn,
            tokens_out = result.TokensOut,
            model      = result.Model
        }, ct);

        await WriteOutputAsync(ctx, "step", step.Id, agent.Id, artifactName: null, output, ct);
        ctx.AppendWork($"{step.Id} ({agent.DisplayName})", output);
        ctx.AppendDecisions(step.Id, output);
    }

    private async Task TryExtractAndStoreFactsAsync(RunContext ctx, CancellationToken ct)
    {
        if (_factsExtractor is null || _globalFactsStore is null) return;
        if (string.IsNullOrWhiteSpace(_factsTopic) ||
            string.IsNullOrWhiteSpace(_playbookId) ||
            string.IsNullOrWhiteSpace(_runId)) return;

        var markdown = ctx.GetFacts();
        if (string.IsNullOrWhiteSpace(markdown)) return;

        IReadOnlyList<FactEntry> facts;
        try
        {
            facts = await _factsExtractor.ExtractAsync(_factsTopic, _runId, _playbookId, markdown, ct);
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine($"[Orchestrator] Facts extract hatası: {ex.Message}");
            return;
        }

        var appended = await _globalFactsStore.AppendUniqueAsync(facts, ct);
        await ctx.AppendLogAsync(new
        {
            type      = "facts_extract",
            ts        = DateTimeOffset.UtcNow,
            runId     = ctx.RunId,
            playbook  = ctx.Playbook.Id,
            extracted = facts.Count,
            appended
        }, ct);
    }

    // ── Operasyon belleği — yazma ─────────────────────────────────────────────

    private async Task TryWriteOperationMemoryAsync(RunContext ctx, CancellationToken ct)
    {
        if (_opMemStore is null) return;

        // fact: FactsExtractor'ın işlemediği ham fact accumulator içeriği de kalıcı olsun
        var factsBlock     = ctx.GetFacts().Trim();
        var decisionsBlock = ctx.GetDecisions().Trim();
        var workBlock      = ctx.GetWork().Trim();

        if (factsBlock.Length > 8) // "# Facts\n\n" den uzunsa içerik var
            await _opMemStore.WriteMemoryAsync("fact", factsBlock, ct);

        if (decisionsBlock.Length > 12) // "# Decisions\n\n"
            await _opMemStore.WriteMemoryAsync("decision", decisionsBlock, ct);

        if (workBlock.Length > 8) // "# Work\n\n"
        {
            // Çok uzun work bloğunu kes — token tavanı (en son 2000 karakter)
            var workContent = workBlock.Length > 2000 ? workBlock[^2000..] : workBlock;
            await _opMemStore.WriteMemoryAsync("work", workContent, ct);
        }

        await ctx.AppendLogAsync(new
        {
            type        = "operation_memory_written",
            ts          = DateTimeOffset.UtcNow,
            operationId = ctx.OperationId,
            runId       = ctx.RunId,
        }, ct);
    }

    // ── Operasyon belleği — okuma ─────────────────────────────────────────────

    private async Task<string> BuildOperationMemoryBlockAsync(CancellationToken ct)
    {
        if (_opMemStore is null) return string.Empty;
        try { return await _opMemStore.BuildMemoryBlockAsync(_maxOperationMemory, ct); }
        catch { return string.Empty; }
    }

    private static string SafeArtifactFileName(string input)
    {
        var name = (input ?? string.Empty).Trim().Replace("\\", "/");
        name = Path.GetFileName(name);
        return string.IsNullOrWhiteSpace(name) ? "artifact.txt" : name;
    }

    private string? BuildExtraPolicy(Agent agent)
    {
        if (agent.Behaviors.AcceptsRubric && !string.IsNullOrWhiteSpace(_verifierRubric))
            return _verifierRubric;

        if (agent.Behaviors.PrefersDomainAllowlist && _preferredDomains.Count > 0)
        {
            var top = _preferredDomains.Take(30).ToArray();
            return "Kaynak politikası:\n" +
                   "- Mümkünse aşağıdaki domainlerden kaynak seç; düşük kaliteli blog/SEO sayfalarını son çare olarak kullan.\n" +
                   "- Her önemli iddia için doğrudan URL ver.\n" +
                   "- Bir iddiayı destekleyen sayfadan kısa kanıt cümlesi ekle.\n\n" +
                   "Tercih edilen domainler (allowlist):\n" +
                   string.Join("\n", top.Select(d => "- " + d));
        }

        return null;
    }

    private Agent ResolveAgent(string agentId)
    {
        if (!_agents.TryGetValue(agentId, out var agent))
            throw new InvalidOperationException($"Unknown agent: {agentId}");
        return agent;
    }

    private string LoadPersonaText(string personaFromArgs, string defaultPersona)
    {
        var persona = string.IsNullOrWhiteSpace(personaFromArgs) ? defaultPersona : personaFromArgs;
        var path    = Path.Combine(_rootDir, "personas", persona + ".md");
        if (!File.Exists(path))
            return $"Persona dosyası bulunamadı: {persona}.md";
        return File.ReadAllText(path);
    }

    private static bool IsFail(string verifierReport)
    {
        // W2 dogfood bug fix: önceki naive 'Contains("FAIL")' her zaman true dönüyordu
        // çünkü rubric/prompt'ta "PASS/FAIL", "FAIL ver:" gibi açıklamalar geçiyor.
        // Yeni kontrat: Verifier çıktısının son satırı 'VERDICT: PASS' veya 'VERDICT: FAIL'
        // olmalı. Burası o etikete bakar; marker yoksa güvenli varsayım PASS'tir (kötü
        // içeriği bir kez kaçırmak, false-positive cascade ile hallüsinasyona davet
        // çıkarmaktan daha az zarar).
        if (string.IsNullOrEmpty(verifierReport)) return false;
        var idxFail = verifierReport.LastIndexOf("VERDICT: FAIL", StringComparison.OrdinalIgnoreCase);
        var idxPass = verifierReport.LastIndexOf("VERDICT: PASS", StringComparison.OrdinalIgnoreCase);
        if (idxFail < 0 && idxPass < 0) return false; // marker yok → güvenli PASS
        return idxFail > idxPass;
    }

    private static string BuildFixPrompt(RunContext ctx, PlaybookStep writeStep, string verifierReport)
    {
        var sb = new StringBuilder();
        sb.AppendLine("Aşağıdaki denetim raporundaki sorunları gidererek çıktıyı revize et.");
        sb.AppendLine();
        sb.AppendLine("Denetim raporu:");
        sb.AppendLine(verifierReport.Trim());
        sb.AppendLine();
        sb.AppendLine("Beklenen çıktı formatı:");
        sb.AppendLine(writeStep.Output);
        sb.AppendLine();
        sb.AppendLine("Kural: Belirsizlikleri saklama; kaynaksız kritik iddia yazma.");
        return sb.ToString();
    }

    // ── Kapı 1: Hafızalı otonomi yardımcıları ────────────────────────────

    /// <summary>
    /// Context'i sliding window ile kısaltır: çok uzun olduğunda baş kısmı atılır,
    /// son MaxContextChars karakteri kalır. Token kaçağını engeller.
    /// </summary>
    private static string TrimContext(string text)
    {
        if (string.IsNullOrEmpty(text) || text.Length <= MaxContextChars)
            return text;

        var tail = text.Substring(text.Length - MaxContextChars);
        return "[... önceki bağlamın baş kısmı bağlam bütçesi nedeniyle kısaltıldı ...]\n\n" + tail;
    }

    /// <summary>
    /// Geçmiş run'lardan biriken facts'leri konuya göre DB'den okur ve
    /// prompt'a inject edilebilir kısa bir blok üretir.
    /// </summary>
    private async Task<string> BuildPriorFactsBlockAsync(string topic, CancellationToken ct)
    {
        if (_factsIndex is null || string.IsNullOrWhiteSpace(topic)) return string.Empty;

        IReadOnlyList<FactEntry> hits;
        // Kapı 5: cross-pack facts varsayılan olarak açık — facts_pack_visibility
        // tablosu boşsa zaten ek sonuç gelmez (DB güvenli). Açık olduğunda persona'nın
        // ait olduğu pack başka pack'lerin görünür facts'lerini de prompt'a alır.
        try { hits = await _factsIndex.SearchAsync(topic, MaxPriorFacts, ct, includeCrossPack: true); }
        catch { return string.Empty; }

        if (hits.Count == 0) return string.Empty;

        var sb = new StringBuilder();
        foreach (var f in hits)
        {
            sb.Append("- ").AppendLine(f.Claim.Trim());
            if (!string.IsNullOrWhiteSpace(f.EvidenceUrl))
                sb.Append("  Kaynak: ").Append(f.EvidenceUrl).Append(" (güven ").AppendFormat("{0:0.00}", f.Confidence).AppendLine(")");
        }
        return sb.ToString();
    }
}
