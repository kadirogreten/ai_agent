using System.Text;

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

        foreach (var step in ctx.Playbook.Steps)
        {
            var agent = ResolveAgent(step.Agent);
            var extraPolicy = BuildExtraPolicy(agent);

            var system = PromptBuilder.BuildSystemPrompt(agent, personaText, extraPolicy);

            var context = ShouldUseFullContext(agent)
                ? await File.ReadAllTextAsync(ctx.WorkPath, Encoding.UTF8, ct)
                : priorWork;
            var user = PromptBuilder.BuildUserPrompt(ctx, step, context);

            var llm = ShouldUseWebSearch(step) ? _webLlm ?? _llm : _llm;

            await ctx.AppendLogAsync(new
            {
                type = "step_start",
                ts = DateTimeOffset.UtcNow,
                runId = ctx.RunId,
                playbook = ctx.Playbook.Id,
                step = step.Id,
                agent = agent.Id
            }, ct);

            var output = await llm.CompleteAsync(system, user, ct);

            await ctx.AppendLogAsync(new
            {
                type = "step_end",
                ts = DateTimeOffset.UtcNow,
                runId = ctx.RunId,
                playbook = ctx.Playbook.Id,
                step = step.Id,
                agent = agent.Id
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

            if (agent.Id.Equals("Researcher", StringComparison.OrdinalIgnoreCase))
            {
                await ctx.AppendMarkdownAsync(ctx.FactsPath, $"{step.Id}", output, ct);
            }

            if (agent.Id.Equals("Analyst", StringComparison.OrdinalIgnoreCase))
            {
                await ctx.AppendMarkdownAsync(ctx.DecisionsPath, $"{step.Id}", output, ct);
            }

            if (agent.Id.Equals("Verifier", StringComparison.OrdinalIgnoreCase))
            {
                verifierReport = output;
            }

            priorWork = output;

            if (ShouldRunContrarian(ctx, step))
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

            if (agent.Id.Equals("Verifier", StringComparison.OrdinalIgnoreCase) && IsFail(verifierReport))
            {
                var writeStep = ctx.Playbook.Steps.FirstOrDefault(s => s.Agent.Equals("Writer", StringComparison.OrdinalIgnoreCase));
                if (writeStep is not null)
                {
                    var writer = ResolveAgent("Writer");
                    var fixSystem = PromptBuilder.BuildSystemPrompt(writer, personaText, extraPolicy: null);
                    var fixUser = BuildFixPrompt(ctx, writeStep, verifierReport);
                    var revised = await _llm.CompleteAsync(fixSystem, fixUser, ct);
                    var revisedFile = Path.Combine(ctx.RunDir, $"write.revised.{writer.Id}.md");
                    await File.WriteAllTextAsync(revisedFile, revised.Trim() + "\n", Encoding.UTF8, ct);
                    await ctx.AppendMarkdownAsync(ctx.WorkPath, $"write.revised ({writer.DisplayName})", revised, ct);
                    priorWork = revised;
                }
            }
        }

        await TryExtractAndStoreFactsAsync(ctx, ct);
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

    private bool ShouldRunContrarian(RunContext ctx, PlaybookStep lastStep)
    {
        var enabled = (ctx.Contract.ToolPermissions ?? string.Empty).Contains("contrarian:on", StringComparison.OrdinalIgnoreCase);
        if (!enabled) return false;
        return lastStep.Agent.Equals("Analyst", StringComparison.OrdinalIgnoreCase);
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

        var output = await _llm.CompleteAsync(system, user, ct);

        await ctx.AppendLogAsync(new
        {
            type = "step_end",
            ts = DateTimeOffset.UtcNow,
            runId = ctx.RunId,
            playbook = ctx.Playbook.Id,
            step = step.Id,
            agent = agent.Id
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

    private static bool ShouldUseWebSearch(PlaybookStep step)
    {
        return step.Agent.Equals("Researcher", StringComparison.OrdinalIgnoreCase);
    }

    private static bool ShouldUseFullContext(Agent agent)
    {
        return agent.Id.Equals("Verifier", StringComparison.OrdinalIgnoreCase)
               || agent.Id.Equals("Editor", StringComparison.OrdinalIgnoreCase)
               || agent.Id.Equals("WebDeveloper", StringComparison.OrdinalIgnoreCase);
    }

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

    private string? BuildExtraPolicy(Agent agent)
    {
        if (agent.Id.Equals("Verifier", StringComparison.OrdinalIgnoreCase))
        {
            return _verifierRubric;
        }

        if (agent.Id.Equals("Researcher", StringComparison.OrdinalIgnoreCase) && _preferredDomains.Count > 0)
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
