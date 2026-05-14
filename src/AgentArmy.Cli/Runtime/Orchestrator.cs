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
        OpenAiImageClient? images
    )
    {
        _llm = llm;
        _webLlm = webLlm;
        _rootDir = rootDir;
        _verifierRubric = verifierRubric;
        _preferredDomains = preferredDomains ?? Array.Empty<string>();
        _factsExtractor = factsExtractor;
        _globalFactsStore = globalFactsStore;
        _factsTopic = factsTopic;
        _playbookId = playbookId;
        _runId = runId;
        _images = images;

        var merged = new Dictionary<string, Agent>(AgentsCatalog.All, StringComparer.OrdinalIgnoreCase);
        if (agentOverrides is not null)
        {
            foreach (var kv in agentOverrides)
            {
                merged[kv.Key] = kv.Value;
            }
        }
        _agents = merged;
    }

    public async Task RunAsync(RunContext ctx, CancellationToken ct)
    {
        Directory.CreateDirectory(ctx.RunDir);
        await File.WriteAllTextAsync(ctx.FactsPath, $"# Facts\n\n", Encoding.UTF8, ct);
        await File.WriteAllTextAsync(ctx.DecisionsPath, $"# Decisions\n\n", Encoding.UTF8, ct);
        await File.WriteAllTextAsync(ctx.WorkPath, $"# Work\n\n", Encoding.UTF8, ct);
        await File.WriteAllTextAsync(ctx.LogPath, string.Empty, Encoding.UTF8, ct);

        var personaText = LoadPersonaText(ctx.Contract.Persona, ctx.Playbook.DefaultPersona);

        string priorWork = string.Empty;
        string verifierReport = string.Empty;

        // IP1.2: Metrik biriktiriciler
        var runStarted   = DateTimeOffset.UtcNow;
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
            var agent = ResolveAgent(step.Agent);
            var extraPolicy = BuildExtraPolicy(agent);

            var system = PromptBuilder.BuildSystemPrompt(agent, personaText, extraPolicy);

            // IP0.2: RequiresFullContext bayrağı — hardcoded Verifier/Editor/WebDeveloper yerine
            var context = agent.Behaviors.RequiresFullContext
                ? await File.ReadAllTextAsync(ctx.WorkPath, Encoding.UTF8, ct)
                : priorWork;
            var user = PromptBuilder.BuildUserPrompt(ctx, step, context);

            // IP0.2: RequiresWebSearch bayrağı — hardcoded "Researcher" kontrolü yerine
            var llm = agent.Behaviors.RequiresWebSearch ? _webLlm ?? _llm : _llm;

            await ctx.AppendLogAsync(new
            {
                type = "step_start",
                ts = DateTimeOffset.UtcNow,
                runId = ctx.RunId,
                playbook = ctx.Playbook.Id,
                step = step.Id,
                agent = agent.Id
            }, ct);

            var result = await llm.CompleteAsync(system, user, ct);
            var output = result.Text;

            // Metrik biriktir
            totalTokensIn  += result.TokensIn;
            totalTokensOut += result.TokensOut;
            lastModel = result.Model;

            await ctx.AppendLogAsync(new
            {
                type = "step_end",
                ts = DateTimeOffset.UtcNow,
                runId = ctx.RunId,
                playbook = ctx.Playbook.Id,
                step = step.Id,
                agent = agent.Id,
                tokens_in  = result.TokensIn,
                tokens_out = result.TokensOut,
                model = result.Model
            }, ct);

            var stepFile = Path.Combine(ctx.RunDir, $"{step.Id}.{agent.Id}.md");
            await File.WriteAllTextAsync(stepFile, output.Trim() + "\n", Encoding.UTF8, ct);
            await ctx.AppendMarkdownAsync(ctx.WorkPath, $"{step.Id} ({agent.DisplayName})", output, ct);

            if (!string.IsNullOrWhiteSpace(step.SaveAs))
            {
                var safeName = SafeArtifactFileName(step.SaveAs);
                var artifactPath = Path.Combine(ctx.RunDir, safeName);
                await File.WriteAllTextAsync(artifactPath, output.Trim() + "\n", Encoding.UTF8, ct);
                await ctx.AppendLogAsync(new
                {
                    type = "artifact_written",
                    ts = DateTimeOffset.UtcNow,
                    runId = ctx.RunId,
                    playbook = ctx.Playbook.Id,
                    step = step.Id,
                    file = safeName
                }, ct);
            }

            if (step.Image is not null)
            {
                await TryGenerateImageAsync(ctx, step, output, ct);
            }

            // IP0.2: WritesToFacts — hardcoded "Researcher" yerine
            if (agent.Behaviors.WritesToFacts)
            {
                await ctx.AppendMarkdownAsync(ctx.FactsPath, $"{step.Id}", output, ct);
            }

            // IP0.2: WritesToDecisions — hardcoded "Analyst" yerine
            if (agent.Behaviors.WritesToDecisions)
            {
                await ctx.AppendMarkdownAsync(ctx.DecisionsPath, $"{step.Id}", output, ct);
            }

            // IP0.2: CapturesVerifierReport — hardcoded "Verifier" yerine
            if (agent.Behaviors.CapturesVerifierReport)
            {
                verifierReport = output;
                verifierOutcome = IsFail(verifierReport) ? "fail" : "pass";
            }

            priorWork = output;

            // IP0.2: TriggersContrarian — hardcoded "Analyst" yerine
            if (ShouldRunContrarian(ctx, agent))
            {
                var contrarianStep = new PlaybookStep
                {
                    Id = "contrarian",
                    Agent = "Contrarian",
                    Goal = "Mevcut bulgular ve iddialar içindeki zayıf noktaları, eksik kanıtları ve alternatif açıklamaları çıkar.",
                    Output = "Markdown: Riskli iddialar, Eksik kaynaklar, Alternatif açıklamalar, Güçlendirme önerileri"
                };
                await RunExtraStepAsync(ctx, contrarianStep, personaText, ct);
            }

            // IP0.2: CapturesVerifierReport + FAIL → writer'a otomatik düzeltme isteği
            if (agent.Behaviors.CapturesVerifierReport && IsFail(verifierReport))
            {
                var writeStep = ctx.Playbook.Steps.FirstOrDefault(s => s.Agent.Equals("Writer", StringComparison.OrdinalIgnoreCase));
                if (writeStep is not null)
                {
                    var writer = ResolveAgent("Writer");
                    var fixSystem = PromptBuilder.BuildSystemPrompt(writer, personaText, extraPolicy: null);
                    var fixUser = BuildFixPrompt(ctx, writeStep, verifierReport);
                    var fixResult = await _llm.CompleteAsync(fixSystem, fixUser, ct);
                    totalTokensIn  += fixResult.TokensIn;
                    totalTokensOut += fixResult.TokensOut;
                    var revised = fixResult.Text;
                    var revisedFile = Path.Combine(ctx.RunDir, $"write.revised.{writer.Id}.md");
                    await File.WriteAllTextAsync(revisedFile, revised.Trim() + "\n", Encoding.UTF8, ct);
                    await ctx.AppendMarkdownAsync(ctx.WorkPath, $"write.revised ({writer.DisplayName})", revised, ct);
                    priorWork = revised;
                }
            }
        }

        await TryExtractAndStoreFactsAsync(ctx, ct);

        // IP1.2: Run metrikleri — report + metrics.json olarak yaz
        var latencyMs = (int)(DateTimeOffset.UtcNow - runStarted).TotalMilliseconds;
        await WriteMetricsAsync(ctx, lastModel, totalTokensIn, totalTokensOut, latencyMs, verifierOutcome, ct);

        await WriteReportAsync(ctx, ct);
    }

    private async Task WriteMetricsAsync(
        RunContext ctx,
        string? model,
        int tokensIn,
        int tokensOut,
        int latencyMs,
        string? verifierOutcome,
        CancellationToken ct)
    {
        var metrics = new
        {
            run_id        = ctx.RunId,
            model         = model ?? _llm.GetType().Name,
            tokens_in     = tokensIn,
            tokens_out    = tokensOut,
            latency_ms    = latencyMs,
            verifier_outcome = verifierOutcome,
            finished_at   = DateTimeOffset.UtcNow
        };

        var json = System.Text.Json.JsonSerializer.Serialize(metrics,
            new System.Text.Json.JsonSerializerOptions { WriteIndented = true });
        var path = Path.Combine(ctx.RunDir, "metrics.json");
        await File.WriteAllTextAsync(path, json + "\n", Encoding.UTF8, ct);

        await ctx.AppendLogAsync(new
        {
            type             = "run_metrics",
            ts               = DateTimeOffset.UtcNow,
            runId            = ctx.RunId,
            model,
            tokens_in        = tokensIn,
            tokens_out       = tokensOut,
            latency_ms       = latencyMs,
            verifier_outcome = verifierOutcome
        }, ct);
    }

    private async Task TryGenerateImageAsync(RunContext ctx, PlaybookStep step, string prompt, CancellationToken ct)
    {
        if (_images is null) return;
        if (string.IsNullOrWhiteSpace(prompt)) return;

        var size = string.IsNullOrWhiteSpace(step.Image?.Size) ? "1024x1024" : step.Image!.Size!.Trim();
        var fileNameBase = string.IsNullOrWhiteSpace(step.Image?.FileName)
            ? $"{step.Id}.image.png"
            : step.Image!.FileName!.Trim();
        var fileName = fileNameBase.EndsWith(".png", StringComparison.OrdinalIgnoreCase)
            ? fileNameBase
            : fileNameBase + ".png";
        var path = Path.Combine(ctx.RunDir, fileName);

        var bytes = await _images.GeneratePngAsync(prompt.Trim(), size, ct);
        await File.WriteAllBytesAsync(path, bytes, ct);

        await ctx.AppendLogAsync(new
        {
            type = "image_generated",
            ts = DateTimeOffset.UtcNow,
            runId = ctx.RunId,
            playbook = ctx.Playbook.Id,
            step = step.Id,
            file = fileName,
            size
        }, ct);
    }

    // IP0.2: TriggersContrarian bayrağı — hardcoded "Analyst" ID kontrolü kaldırıldı
    private bool ShouldRunContrarian(RunContext ctx, Agent agent)
    {
        var enabled = (ctx.Contract.ToolPermissions ?? string.Empty).Contains("contrarian:on", StringComparison.OrdinalIgnoreCase);
        return enabled && agent.Behaviors.TriggersContrarian;
    }

    private async Task RunExtraStepAsync(RunContext ctx, PlaybookStep step, string personaText, CancellationToken ct)
    {
        var agent = ResolveAgent(step.Agent);
        var extraPolicy = BuildExtraPolicy(agent);
        var system = PromptBuilder.BuildSystemPrompt(agent, personaText, extraPolicy);
        var context = await File.ReadAllTextAsync(ctx.WorkPath, Encoding.UTF8, ct);
        var user = PromptBuilder.BuildUserPrompt(ctx, step, context);

        await ctx.AppendLogAsync(new
        {
            type = "step_start",
            ts = DateTimeOffset.UtcNow,
            runId = ctx.RunId,
            playbook = ctx.Playbook.Id,
            step = step.Id,
            agent = agent.Id
        }, ct);

        var result = await _llm.CompleteAsync(system, user, ct);
        var output = result.Text;

        await ctx.AppendLogAsync(new
        {
            type = "step_end",
            ts = DateTimeOffset.UtcNow,
            runId = ctx.RunId,
            playbook = ctx.Playbook.Id,
            step = step.Id,
            agent = agent.Id,
            tokens_in  = result.TokensIn,
            tokens_out = result.TokensOut,
            model = result.Model
        }, ct);

        var stepFile = Path.Combine(ctx.RunDir, $"{step.Id}.{agent.Id}.md");
        await File.WriteAllTextAsync(stepFile, output.Trim() + "\n", Encoding.UTF8, ct);
        await ctx.AppendMarkdownAsync(ctx.WorkPath, $"{step.Id} ({agent.DisplayName})", output, ct);
        await ctx.AppendMarkdownAsync(ctx.DecisionsPath, $"{step.Id}", output, ct);
    }

    private async Task TryExtractAndStoreFactsAsync(RunContext ctx, CancellationToken ct)
    {
        if (_factsExtractor is null) return;
        if (_globalFactsStore is null) return;
        if (string.IsNullOrWhiteSpace(_factsTopic)) return;
        if (string.IsNullOrWhiteSpace(_playbookId)) return;
        if (string.IsNullOrWhiteSpace(_runId)) return;

        var markdown = await File.ReadAllTextAsync(ctx.FactsPath, Encoding.UTF8, ct);
        if (string.IsNullOrWhiteSpace(markdown)) return;

        IReadOnlyList<FactEntry> facts;
        try
        {
            facts = await _factsExtractor.ExtractAsync(_factsTopic, _runId, _playbookId, markdown, ct);
        }
        catch (Exception ex)
        {
            var rawPath = Path.Combine(ctx.RunDir, "facts.extraction.error.txt");
            await File.WriteAllTextAsync(rawPath, ex.Message, Encoding.UTF8, ct);
            return;
        }

        var runFactsPath = Path.Combine(ctx.RunDir, "facts.json");
        var json = System.Text.Json.JsonSerializer.Serialize(facts, new System.Text.Json.JsonSerializerOptions { WriteIndented = true });
        await File.WriteAllTextAsync(runFactsPath, json + "\n", Encoding.UTF8, ct);

        var appended = await _globalFactsStore.AppendUniqueAsync(facts, ct);
        await ctx.AppendLogAsync(new
        {
            type = "facts_extract",
            ts = DateTimeOffset.UtcNow,
            runId = ctx.RunId,
            playbook = ctx.Playbook.Id,
            extracted = facts.Count,
            appended
        }, ct);
    }

    // IP0.2: Bu metodlar artık kullanılmıyor — behaviors bayraklarına geçildi.
    // Geriye dönük uyumluluk için bırakıldı; ilerleyen versiyonda kaldırılabilir.

    private static string SafeArtifactFileName(string input)
    {
        var name = (input ?? string.Empty).Trim();
        name = name.Replace("\\", "/");
        name = Path.GetFileName(name);
        if (string.IsNullOrWhiteSpace(name))
        {
            return "artifact.txt";
        }
        return name;
    }

    private async Task WriteReportAsync(RunContext ctx, CancellationToken ct)
    {
        var report = new
        {
            runId = ctx.RunId,
            playbook = new { id = ctx.Playbook.Id, title = ctx.Playbook.Title },
            contract = ctx.Contract,
            selectedAgents = ctx.SelectedAgents,
            generatedAt = DateTimeOffset.UtcNow,
            sections = new[]
            {
                new { id = "summary", title = "Özet", format = "markdown", content = BuildSummary(ctx) },
                new { id = "artifacts", title = "Üretilen Dosyalar", format = "markdown", content = BuildArtifactsSection(ctx) },
                new { id = "work", title = "Genel Çıktı (Work)", format = "markdown", content = await ReadTextOrEmptyAsync(ctx.WorkPath, ct) },
                new { id = "facts", title = "Facts", format = "markdown", content = await ReadTextOrEmptyAsync(ctx.FactsPath, ct) },
                new { id = "decisions", title = "Decisions", format = "markdown", content = await ReadTextOrEmptyAsync(ctx.DecisionsPath, ct) }
            }
        };

        var reportJsonPath = Path.Combine(ctx.RunDir, "report.json");
        var reportJson = JsonSerializer.Serialize(report, new JsonSerializerOptions { WriteIndented = true });
        await File.WriteAllTextAsync(reportJsonPath, reportJson + "\n", Encoding.UTF8, ct);

        var reportMdPath = Path.Combine(ctx.RunDir, "report.md");
        var md = new StringBuilder();
        md.AppendLine("# Report");
        md.AppendLine();
        md.AppendLine("## Özet");
        md.AppendLine();
        md.AppendLine(BuildSummary(ctx));
        md.AppendLine();
        md.AppendLine("## Üretilen Dosyalar");
        md.AppendLine();
        md.AppendLine(BuildArtifactsSection(ctx));
        md.AppendLine();
        md.AppendLine("## Genel Çıktı (Work)");
        md.AppendLine();
        md.AppendLine((await ReadTextOrEmptyAsync(ctx.WorkPath, ct)).Trim());
        md.AppendLine();
        md.AppendLine("## Facts");
        md.AppendLine();
        md.AppendLine((await ReadTextOrEmptyAsync(ctx.FactsPath, ct)).Trim());
        md.AppendLine();
        md.AppendLine("## Decisions");
        md.AppendLine();
        md.AppendLine((await ReadTextOrEmptyAsync(ctx.DecisionsPath, ct)).Trim());
        md.AppendLine();
        await File.WriteAllTextAsync(reportMdPath, md.ToString(), Encoding.UTF8, ct);

        await ctx.AppendLogAsync(new
        {
            type = "report_written",
            ts = DateTimeOffset.UtcNow,
            runId = ctx.RunId,
            playbook = ctx.Playbook.Id,
            files = new[] { "report.json", "report.md" }
        }, ct);
    }

    private static string BuildSummary(RunContext ctx)
    {
        var sb = new StringBuilder();
        sb.AppendLine($"- RunId: {ctx.RunId}");
        sb.AppendLine($"- Playbook: {ctx.Playbook.Id} ({ctx.Playbook.Title})");
        sb.AppendLine($"- Topic: {ctx.Contract.Topic}");
        if (ctx.SelectedAgents.Count > 0)
        {
            sb.AppendLine($"- Seçili ajanlar: {string.Join(", ", ctx.SelectedAgents)}");
        }
        else
        {
            sb.AppendLine("- Seçili ajanlar: (tümü)");
        }
        return sb.ToString().Trim();
    }

    private static string BuildArtifactsSection(RunContext ctx)
    {
        var files = Directory.EnumerateFiles(ctx.RunDir, "*", SearchOption.TopDirectoryOnly)
            .Select(p => new FileInfo(p))
            .OrderByDescending(f => f.LastWriteTimeUtc)
            .ToArray();

        var sb = new StringBuilder();
        foreach (var f in files)
        {
            sb.Append("- ");
            sb.Append(f.Name);
            sb.Append(" (");
            sb.Append(f.Length);
            sb.AppendLine(" bytes)");
        }
        return sb.ToString().Trim();
    }

    private static async Task<string> ReadTextOrEmptyAsync(string path, CancellationToken ct)
    {
        try
        {
            if (!File.Exists(path)) return string.Empty;
            return await File.ReadAllTextAsync(path, Encoding.UTF8, ct);
        }
        catch
        {
            return string.Empty;
        }
    }

    // IP0.2: AcceptsRubric + PrefersDomainAllowlist bayrakları
    // Hardcoded "Verifier"/"Researcher" ID kontrolü kaldırıldı.
    private string? BuildExtraPolicy(Agent agent)
    {
        if (agent.Behaviors.AcceptsRubric && !string.IsNullOrWhiteSpace(_verifierRubric))
        {
            return _verifierRubric;
        }

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
        {
            throw new InvalidOperationException($"Unknown agent: {agentId}");
        }
        return agent;
    }

    private string LoadPersonaText(string personaFromArgs, string defaultPersona)
    {
        var persona = string.IsNullOrWhiteSpace(personaFromArgs) ? defaultPersona : personaFromArgs;
        var path = Path.Combine(_rootDir, "personas", persona + ".md");
        if (!File.Exists(path))
        {
            return $"Persona dosyası bulunamadı: {persona}.md";
        }
        return File.ReadAllText(path);
    }

    private static bool IsFail(string verifierReport)
    {
        return verifierReport.Contains("FAIL", StringComparison.OrdinalIgnoreCase);
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
}
