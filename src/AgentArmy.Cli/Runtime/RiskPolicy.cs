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
}

