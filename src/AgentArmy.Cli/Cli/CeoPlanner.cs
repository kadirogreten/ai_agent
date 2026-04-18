using System.Text;
using System.Text.Json;

namespace AgentArmy.Cli;

public sealed class CeoPlanner
{
    private readonly ILlmClient _llm;

    public CeoPlanner(ILlmClient llm)
    {
        _llm = llm;
    }

    public sealed record PlannedRun(
        string Mode,
        string Id,
        string Topic,
        string Risk,
        bool Web,
        bool Contrarian
    );

    public sealed record Plan(
        string DomainPack,
        string PrimaryTopic,
        List<string> Subtopics,
        List<string> ClarifyingQuestions,
        List<PlannedRun> Runs,
        string Rationale
    );

    public async Task<Plan> PlanAsync(string request, string? answersJson, DomainPack domainPack, CancellationToken ct)
    {
        var system = "Sen bir CEO/Chief of Staff ajansın. Kullanıcı isteğini doğru playbook/bundle'a yönlendirirsin. Sadece JSON döndürürsün.";

        var user = BuildPrompt(request, answersJson, domainPack);
        var json = await _llm.CompleteAsync(system, user, ct);
        try
        {
            return ParsePlan(json);
        }
        catch
        {
            return new Plan(
                DomainPack: domainPack.Id,
                PrimaryTopic: request.Trim(),
                Subtopics: new List<string>(),
                ClarifyingQuestions: new List<string> { "Hedef kitle kim? (PM/Sales/Exec)" },
                Runs: new List<PlannedRun>
                {
                    new PlannedRun("bundle", "weekly", request.Trim(), "R1", true, false)
                },
                Rationale: "Fallback plan (dry-run veya parse hatası)."
            );
        }
    }

    private static string BuildPrompt(string request, string? answersJson, DomainPack domainPack)
    {
        var sb = new StringBuilder();
        sb.AppendLine("Bugünün tarihi (UTC): " + DateTimeOffset.UtcNow.ToString("yyyy-MM-dd"));
        sb.AppendLine();
        sb.AppendLine("Kullanıcı isteği:");
        sb.AppendLine(request.Trim());

        if (!string.IsNullOrWhiteSpace(answersJson))
        {
            sb.AppendLine();
            sb.AppendLine("Kullanıcı yanıtları (JSON):");
            sb.AppendLine(answersJson.Trim());
        }

        sb.AppendLine();
        sb.AppendLine("DomainPack: " + domainPack.Id);
        sb.AppendLine();
        sb.AppendLine("Kurallar:");
        sb.AppendLine("- SADECE JSON döndür. Markdown, açıklama, kod bloğu yok.");
        sb.AppendLine("- JSON schema:");
        sb.AppendLine("  {");
        sb.AppendLine("    domainPack: string,");
        sb.AppendLine("    primaryTopic: string,");
        sb.AppendLine("    subtopics: string[],");
        sb.AppendLine("    clarifyingQuestions: string[],");
        sb.AppendLine("    runs: { mode: \"playbook\"|\"bundle\", id: string, topic: string, risk: \"R0\"|\"R1\"|\"R2\"|\"R3\", web: boolean, contrarian: boolean }[],");
        sb.AppendLine("    rationale: string");
        sb.AppendLine("  }");
        sb.AppendLine("- Varsayılan risk R1 olmalı. Çok gerekli değilse R2/R3 seçme.");
        sb.AppendLine("- web true, market/competitive intel türü işler için önerilir.");
        sb.AppendLine("- primaryTopic kısa ve net olmalı.");
        sb.AppendLine("- subtopics: CEO'nun kendi inisiyatifiyle takip soruları/alt başlıklar (max 5)." );
        sb.AppendLine("- clarifyingQuestions: Kullanıcıya sorulacak sorular (max 5)." );
        sb.AppendLine("- runs: max 5 run üret; gerekirse bundle kullan." );
        sb.AppendLine();
        sb.AppendLine("Mevcut bundle'lar:");
        foreach (var b in BundleLoader.ListBundles(domainPack.RootDir, domainPack))
        {
            sb.AppendLine("- " + b);
        }
        sb.AppendLine();
        sb.AppendLine("Mevcut playbook'lar:");
        foreach (var p in PlaybookLoader.ListPlaybooks(domainPack.RootDir, domainPack))
        {
            sb.AppendLine("- " + p);
        }

        var factsIndexPath = Path.Combine(domainPack.RootDir, "knowledge", domainPack.Id, "facts.jsonl");
        if (File.Exists(factsIndexPath))
        {
            sb.AppendLine();
            sb.AppendLine("Mevcut bilgi deposundan ilgili faktlar (kısa):");

            var index = new FactsIndex(factsIndexPath);
            var facts = index.Search(request, maxFacts: 12);
            foreach (var f in facts)
            {
                sb.AppendLine($"- claim: {f.Claim}");
                sb.AppendLine($"  url: {f.EvidenceUrl}");
                sb.AppendLine($"  conf: {f.Confidence:0.00}");
            }
        }

        return sb.ToString();
    }

    private static Plan ParsePlan(string json)
    {
        var trimmed = json.Trim();
        using var doc = JsonDocument.Parse(trimmed);
        var root = doc.RootElement;
        if (root.ValueKind != JsonValueKind.Object)
        {
            throw new InvalidOperationException("CEO plan is not a JSON object.");
        }

        string GetString(string name)
        {
            return root.TryGetProperty(name, out var el) && el.ValueKind == JsonValueKind.String
                ? (el.GetString() ?? string.Empty)
                : string.Empty;
        }

        List<string> GetStringArray(string name)
        {
            var list = new List<string>();
            if (!root.TryGetProperty(name, out var el) || el.ValueKind != JsonValueKind.Array) return list;
            foreach (var item in el.EnumerateArray())
            {
                if (item.ValueKind == JsonValueKind.String)
                {
                    var s = item.GetString();
                    if (!string.IsNullOrWhiteSpace(s)) list.Add(s.Trim());
                }
            }
            return list;
        }

        List<PlannedRun> GetRuns()
        {
            var list = new List<PlannedRun>();
            if (!root.TryGetProperty("runs", out var el) || el.ValueKind != JsonValueKind.Array) return list;
            foreach (var r in el.EnumerateArray())
            {
                if (r.ValueKind != JsonValueKind.Object) continue;

                string S(string name)
                {
                    return r.TryGetProperty(name, out var x) && x.ValueKind == JsonValueKind.String ? (x.GetString() ?? string.Empty) : string.Empty;
                }

                bool B(string name)
                {
                    return r.TryGetProperty(name, out var x) && (x.ValueKind == JsonValueKind.True || x.ValueKind == JsonValueKind.False) ? x.GetBoolean() : false;
                }

                var mode = S("mode");
                var id = S("id");
                var topic = S("topic");
                var risk = S("risk");
                var web = B("web");
                var contrarian = B("contrarian");

                if (string.IsNullOrWhiteSpace(mode) || string.IsNullOrWhiteSpace(id)) continue;
                if (string.IsNullOrWhiteSpace(risk)) risk = "R1";
                list.Add(new PlannedRun(mode, id, topic ?? string.Empty, risk, web, contrarian));
            }
            return list;
        }

        var domainPack = GetString("domainPack");
        var primaryTopic = GetString("primaryTopic");
        var rationale = GetString("rationale");
        var subtopics = GetStringArray("subtopics").Take(5).ToList();
        var questions = GetStringArray("clarifyingQuestions").Take(5).ToList();
        var runs = GetRuns().Take(5).ToList();

        if (runs.Count == 0)
        {
            throw new InvalidOperationException("CEO plan missing runs.");
        }

        return new Plan(domainPack, primaryTopic, subtopics, questions, runs, rationale);
    }
}
