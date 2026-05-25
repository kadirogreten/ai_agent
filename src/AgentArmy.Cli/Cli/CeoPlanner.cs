using System.Text;
using System.Text.Json;

namespace AgentArmy.Cli;

public sealed class CeoPlanner
{
    private readonly ILlmClient _llm;
    private readonly SupabaseWriter? _db;

    public CeoPlanner(ILlmClient llm, SupabaseWriter? db = null)
    {
        _llm = llm;
        _db  = db;
    }

    public sealed record PlannedRun(
        string Mode,
        string Id,
        string Topic,
        string Risk,
        bool Web,
        bool Contrarian,
        string? Pack = null  // Kapı 5: cross-pack run; null = primary pack
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

        var user = await BuildPromptAsync(request, answersJson, domainPack, ct);
        var json = (await _llm.CompleteAsync(system, user, ct)).Text;
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

    private async Task<string> BuildPromptAsync(string request, string? answersJson, DomainPack domainPack, CancellationToken ct)
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
        sb.AppendLine("    runs: { mode: \"playbook\"|\"bundle\", id: string, topic: string, risk: \"R0\"|\"R1\"|\"R2\"|\"R3\", web: boolean, contrarian: boolean, pack?: string }[],");
        sb.AppendLine("    rationale: string");
        sb.AppendLine("  }");
        sb.AppendLine("- Varsayılan risk R1 olmalı. Çok gerekli değilse R2/R3 seçme.");
        sb.AppendLine("- web true, market/competitive intel türü işler için önerilir.");
        sb.AppendLine("- primaryTopic kısa ve net olmalı.");
        sb.AppendLine("- subtopics: CEO'nun kendi inisiyatifiyle takip soruları/alt başlıklar (max 5)." );
        sb.AppendLine("- clarifyingQuestions: Kullanıcıya sorulacak sorular (max 5)." );
        sb.AppendLine("- runs: max 5 run üret; gerekirse bundle kullan." );
        sb.AppendLine();
        // Primary pack bundle'larını DB'den yükle — dosyaya bakılmaz.
        sb.AppendLine("Mevcut bundle'lar:");
        if (_db is not null)
        {
            try
            {
                var bundles = await _db.SelectAsync(
                    "playbook_bundles",
                    $"pack_id=eq.{Uri.EscapeDataString(domainPack.Id)}&select=slug,name,default_risk&limit=20",
                    ct);
                if (bundles.ValueKind == JsonValueKind.Array)
                {
                    foreach (var b in bundles.EnumerateArray())
                    {
                        var slug = b.TryGetProperty("slug", out var sl) && sl.ValueKind == JsonValueKind.String ? sl.GetString() : null;
                        var name = b.TryGetProperty("name", out var nm) && nm.ValueKind == JsonValueKind.String ? nm.GetString() : null;
                        if (!string.IsNullOrWhiteSpace(slug))
                            sb.AppendLine($"- {slug}" + (string.IsNullOrWhiteSpace(name) ? "" : $" ({name})"));
                    }
                }
            }
            catch (Exception ex)
            {
                Console.Error.WriteLine($"[CeoPlanner] bundle listeleme hatası: {ex.Message}");
            }
        }
        else
        {
            foreach (var b in BundleLoader.ListBundles(domainPack.RootDir, domainPack))
                sb.AppendLine("- " + b);
        }

        sb.AppendLine();

        // Primary pack playbook'larını DB'den yükle — dosyaya bakılmaz.
        sb.AppendLine("Mevcut playbook'lar:");
        if (_db is not null)
        {
            try
            {
                var pbs = await _db.SelectAsync(
                    "playbooks",
                    $"pack_id=eq.{Uri.EscapeDataString(domainPack.Id)}&select=slug,name,default_risk&limit=30",
                    ct);
                if (pbs.ValueKind == JsonValueKind.Array)
                {
                    foreach (var p in pbs.EnumerateArray())
                    {
                        var slug = p.TryGetProperty("slug", out var sl) && sl.ValueKind == JsonValueKind.String ? sl.GetString() : null;
                        var name = p.TryGetProperty("name", out var nm) && nm.ValueKind == JsonValueKind.String ? nm.GetString() : null;
                        if (!string.IsNullOrWhiteSpace(slug))
                            sb.AppendLine($"- {slug}" + (string.IsNullOrWhiteSpace(name) ? "" : $" ({name})"));
                    }
                }
            }
            catch (Exception ex)
            {
                Console.Error.WriteLine($"[CeoPlanner] playbook listeleme hatası: {ex.Message}.");
            }
        }
        else
        {
            foreach (var p in PlaybookLoader.ListPlaybooks(domainPack.RootDir, domainPack))
                sb.AppendLine("- " + p);
        }

        // Kapı 5: Cross-pack görünür pack'lerin playbook'larını da listele.
        // CEO multi-pack hedef için ilgili pack'in playbook'larını seçebilsin.
        if (_db is not null)
        {
            try
            {
                var visible = await _db.SelectAsync(
                    "rpc/visible_packs_for",
                    $"p_pack_id={Uri.EscapeDataString(domainPack.Id)}",
                    ct);
                if (visible.ValueKind == JsonValueKind.Array)
                {
                    foreach (var packEl in visible.EnumerateArray())
                    {
                        if (!packEl.TryGetProperty("pack_id", out var p) || p.ValueKind != JsonValueKind.String) continue;
                        var otherPack = p.GetString();
                        if (string.IsNullOrWhiteSpace(otherPack) || string.Equals(otherPack, domainPack.Id, StringComparison.OrdinalIgnoreCase))
                            continue;

                        var pbs = await _db.SelectAsync(
                            "playbooks",
                            $"pack_id=eq.{Uri.EscapeDataString(otherPack!)}&select=slug,name,default_risk&limit=20",
                            ct);
                        if (pbs.ValueKind != JsonValueKind.Array || pbs.GetArrayLength() == 0) continue;

                        sb.AppendLine();
                        sb.AppendLine($"Cross-pack görünür: {otherPack} (pack=\"{otherPack}\" olarak runs'a koy)");
                        foreach (var pb in pbs.EnumerateArray())
                        {
                            var slug = pb.TryGetProperty("slug", out var sl) && sl.ValueKind == JsonValueKind.String ? sl.GetString() : null;
                            if (!string.IsNullOrWhiteSpace(slug)) sb.AppendLine("- " + slug);
                        }
                    }
                }
            }
            catch (Exception ex)
            {
                Console.Error.WriteLine($"[CeoPlanner] cross-pack listing hatası: {ex.Message}");
            }
        }

        // Geçmiş facts'ler artık DB'den okunuyor — tek hakikat kaynağı.
        if (_db is not null)
        {
            var index = new FactsIndex(_db, domainPack.Id);
            // Kapı 5: CEO planner çapraz pack facts'leri de düşünsün (multi-pack hedefler için).
            var facts = await index.SearchAsync(request, maxFacts: 12, ct, includeCrossPack: true);
            if (facts.Count > 0)
            {
                sb.AppendLine();
                sb.AppendLine("Mevcut bilgi deposundan ilgili faktlar (kısa):");
                foreach (var f in facts)
                {
                    sb.AppendLine($"- claim: {f.Claim}");
                    sb.AppendLine($"  url: {f.EvidenceUrl}");
                    sb.AppendLine($"  conf: {f.Confidence:0.00}");
                }
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
                var pack = S("pack");  // Kapı 5: opsiyonel cross-pack

                if (string.IsNullOrWhiteSpace(mode) || string.IsNullOrWhiteSpace(id)) continue;
                if (string.IsNullOrWhiteSpace(risk)) risk = "R1";
                list.Add(new PlannedRun(mode, id, topic ?? string.Empty, risk, web, contrarian,
                    string.IsNullOrWhiteSpace(pack) ? null : pack));
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
