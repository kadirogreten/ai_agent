using System.Text;

namespace AgentArmy.Cli;

public static class HelpText
{
    public static string Build()
    {
        var sb = new StringBuilder();
        sb.AppendLine("AgentArmy CLI — ajan sürüsü orkestratörü");
        sb.AppendLine();
        sb.AppendLine("Hızlı başlangıç:");
        sb.AppendLine("  1. setup                     OpenAI anahtarını kaydet");
        sb.AppendLine("  2. list --domainPack <id>    mevcut playbook'ları gör");
        sb.AppendLine("  3. run --playbook <id> ...   bir playbook çalıştır");
        sb.AppendLine("     veya  ceo --request \"...\"  hedef ver, sürü planlasın");
        sb.AppendLine();
        sb.AppendLine("Kurulum:");
        sb.AppendLine("  setup [--model <name>]       OpenAI anahtarını sor & kaydet");
        sb.AppendLine("  setup-env [--model <name>]   Anahtarı OPENAI_API_KEY ortam değişkeninden al");
        sb.AppendLine();
        sb.AppendLine("Keşif:");
        sb.AppendLine("  list [--domainPack <id>]     Playbook'ları listele");
        sb.AppendLine("  bundles --domainPack <id>    Playbook setlerini listele");
        sb.AppendLine();
        sb.AppendLine("Çalıştır:");
        sb.AppendLine("  run --playbook <id> [seçenekler]       Tek playbook çalıştır");
        sb.AppendLine("  bundle --domainPack <id> [seçenekler]  Playbook setini arka arkaya çalıştır");
        sb.AppendLine("  ceo --domainPack <id> --request <text> Hedeften otomatik plan + çalıştır");
        sb.AppendLine("  ceo-iterate ... --answers <json>       CEO sorularına cevap verip yeniden planla");
        sb.AppendLine();
        sb.AppendLine("Ortak seçenekler (run/bundle):");
        sb.AppendLine("  --topic <text>  --persona <id>  --risk R0|R1|R2|R3  --allowHighRisk true|false");
        sb.AppendLine("  --dryRun true|false  --web true|false  --model <name>  --facts true|false");
        sb.AppendLine("  --contrarian true|false  --tools \"tools: web_scrape; max_calls: 3\"  --agents A,B,C");
        sb.AppendLine();
        sb.AppendLine("Compensation:");
        sb.AppendLine("  compensate --invocationId <uuid>   Tek bir araç çağrısını geri al (delete_object / cancel_order)");
        sb.AppendLine();
        sb.AppendLine("Örnekler:");
        sb.AppendLine("  dotnet run --project src/AgentArmy.Cli -- setup --model gpt-5");
        sb.AppendLine("  dotnet run --project src/AgentArmy.Cli -- list --domainPack market-intel");
        sb.AppendLine("  dotnet run --project src/AgentArmy.Cli -- run --playbook mi-trend-radar --topic \"AI agent platforms\" --web true --domainPack market-intel");
        sb.AppendLine("  dotnet run --project src/AgentArmy.Cli -- ceo --domainPack market-intel --request \"Bu hafta AI agent platformlarında önemli gelişmeler neler?\"");
        sb.AppendLine("  dotnet run --project src/AgentArmy.Cli -- run --playbook tech-design --topic \"Basit CLI\" --dryRun true");
        return sb.ToString();
    }
}
