using System.Text;

namespace AgentArmy.Cli;

public static class HelpText
{
    public static string Build()
    {
        var sb = new StringBuilder();
        sb.AppendLine("AgentArmy CLI");
        sb.AppendLine();
        sb.AppendLine("Commands:");
        sb.AppendLine("  list [--domainPack <id>]");
        sb.AppendLine("  bundles --domainPack <id>");
        sb.AppendLine("  run --playbook <id> [--topic <text>] [--persona <id>] [--risk R0|R1|R2|R3] [--allowHighRisk true|false] [--dryRun true|false] [--web true|false] [--domainPack <id>] [--model <name>] [--facts true|false] [--contrarian true|false] [--agentsFile <path>]");
        sb.AppendLine("  bundle --domainPack <id> [--id <bundleId>] [--topic <text>] [--risk R0|R1|R2|R3] [--allowHighRisk true|false] [--web true|false] [--model <name>] [--dryRun true|false] [--contrarian true|false] [--agentsFile <path>]");
        sb.AppendLine("  ceo --domainPack <id> --request <text> [--model <name>] [--dryRun true|false] [--agentsFile <path>]");
        sb.AppendLine("  ceo-iterate --domainPack <id> --request <text> --answers <json> [--model <name>] [--dryRun true|false] [--agentsFile <path>]");
        sb.AppendLine("  setup [--model <name>]");
        sb.AppendLine("  setup-env [--model <name>]");
        sb.AppendLine();
        sb.AppendLine("Examples:");
        sb.AppendLine("  dotnet run --project src/AgentArmy.Cli -- list");
        sb.AppendLine("  dotnet run --project src/AgentArmy.Cli -- list --domainPack market-intel");
        sb.AppendLine("  dotnet run --project src/AgentArmy.Cli -- bundles --domainPack market-intel");
        sb.AppendLine("  dotnet run --project src/AgentArmy.Cli -- setup --model gpt-5");
        sb.AppendLine("  dotnet run --project src/AgentArmy.Cli -- setup-env --model gpt-5");
        sb.AppendLine("  dotnet run --project src/AgentArmy.Cli -- run --playbook mi-trend-radar --topic \"AI agent platforms\" --web true --domainPack market-intel --model gpt-5");
        sb.AppendLine("  dotnet run --project src/AgentArmy.Cli -- bundle --domainPack market-intel --id weekly --topic \"AI agent platforms\" --web true --model gpt-5");
        sb.AppendLine("  dotnet run --project src/AgentArmy.Cli -- ceo --domainPack market-intel --request \"Bu hafta AI agent platformlarında önemli gelişmeler neler?\" --model gpt-5");
        sb.AppendLine("  dotnet run --project src/AgentArmy.Cli -- ceo-iterate --domainPack market-intel --request \"AI agent platforms haftalık brief\" --answers \"{\\\"audience\\\":\\\"PM\\\"}\" --model gpt-4.1");
        sb.AppendLine("  dotnet run --project src/AgentArmy.Cli -- run --playbook tech-design --topic \"Basit CLI\" --dryRun true");
        return sb.ToString();
    }
}
