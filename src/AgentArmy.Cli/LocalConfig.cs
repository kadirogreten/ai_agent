using System.Text.Json;

namespace AgentArmy.Cli;

public sealed class LocalConfig
{
    public OpenAiConfig? OpenAI { get; set; }

    public sealed class OpenAiConfig
    {
        public string? ApiKey { get; set; }
        public string? Model { get; set; }
    }

    public static LocalConfig? TryLoad(string rootDir)
    {
        var path = Path.Combine(rootDir, "agentarmy.local.json");
        if (!File.Exists(path)) return null;

        var json = File.ReadAllText(path);
        return JsonSerializer.Deserialize<LocalConfig>(json, new JsonSerializerOptions
        {
            PropertyNameCaseInsensitive = true
        });
    }
}

