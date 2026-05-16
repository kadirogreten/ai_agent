namespace AgentArmy.Cli;

public static class RiskPolicy
{
    public static int Rank(string risk)
    {
        if (string.IsNullOrWhiteSpace(risk)) return 1;
        var r = risk.Trim().ToUpperInvariant();
        return r switch
        {
            "R0" => 0,
            "R1" => 1,
            "R2" => 2,
            "R3" => 3,
            _ => 1
        };
    }

    public static void Enforce(Dictionary<string, string> args)
    {
        var risk = args.GetValueOrDefault("risk") ?? "R1";
        var rank = Rank(risk);

        if (rank < 2) return;

        var allow = (args.GetValueOrDefault("allowHighRisk") ?? "false").Equals("true", StringComparison.OrdinalIgnoreCase);
        if (!allow)
        {
            throw new InvalidOperationException("R2/R3 risk için onay gerekli. `--allowHighRisk true` ekle.");
        }
    }

    /// <summary>
    /// CLI'da --risk yoksa (veya boşsa), verilen playbook(lar)ın <see cref="Playbook.DefaultRisk"/> değerlerinden
    /// en yüksek risk sınıfını <c>args["risk"]</c> olarak yazar. Bundle'da karışık R0/R2 için zorunlu.
    /// </summary>
    public static void MergeDefaultRiskFromPlaybooks(Dictionary<string, string> args, IEnumerable<Playbook> playbooks)
    {
        var riskArg = args.TryGetValue("risk", out var r) ? r.Trim() : null;
        if (!string.IsNullOrWhiteSpace(riskArg)) return;

        var highest = 1;
        string code = "R1";
        foreach (var p in playbooks)
        {
            var c = string.IsNullOrWhiteSpace(p.DefaultRisk) ? "R1" : p.DefaultRisk.Trim();
            var rank = Rank(c);
            if (rank > highest)
            {
                highest = rank;
                code = c;
            }
        }
        args["risk"] = code;
    }

    /// <summary>
    /// Görev/playbook risk seviyesi persona tavanını aşıyorsa hata fırlatır.
    /// Örn. persona R2 iken görev R3 → reddedilir.
    /// </summary>
    public static void EnforceTaskRiskAgainstPersonaCeiling(string taskRisk, PersonaProfile persona)
    {
        var taskRank    = Rank(taskRisk);
        var ceilingRank = Rank(persona.RiskCeiling);
        if (taskRank <= ceilingRank) return;

        throw new InvalidOperationException(
            $"Görev riski ({NormalizeRiskLabel(taskRisk)}) persona '{persona.Slug}' tavanını " +
            $"({NormalizeRiskLabel(persona.RiskCeiling)}) aşıyor. Daha düşük risk seçin veya farklı persona kullanın.");
    }

    private static string NormalizeRiskLabel(string risk)
    {
        var r = (risk ?? "R1").Trim().ToUpperInvariant();
        return r is "R0" or "R1" or "R2" or "R3" ? r : "R1";
    }
}

