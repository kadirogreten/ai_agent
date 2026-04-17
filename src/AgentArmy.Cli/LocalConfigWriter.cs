using System.Text.Encodings.Web;
using System.Text.Json;

namespace AgentArmy.Cli;

public static class LocalConfigWriter
{
    public static void Write(string rootDir, string apiKey, string model)
    {
        var path = Path.Combine(rootDir, "agentarmy.local.json");
        var cfg = new LocalConfig
        {
            OpenAI = new LocalConfig.OpenAiConfig
            {
                ApiKey = apiKey,
                Model = model
            }
        };

        var json = JsonSerializer.Serialize(cfg, new JsonSerializerOptions
        {
            WriteIndented = true,
            Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping,
            PropertyNamingPolicy = JsonNamingPolicy.CamelCase
        });

        File.WriteAllText(path, json);
    }
}

