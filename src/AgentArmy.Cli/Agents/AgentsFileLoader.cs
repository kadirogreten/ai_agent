using System.Text;
using System.Text.Json;

namespace AgentArmy.Cli;

public static class AgentsFileLoader
{
    public static IReadOnlyDictionary<string, Agent> LoadAgents(string? path)
    {
        if (string.IsNullOrWhiteSpace(path))
        {
            return new Dictionary<string, Agent>(StringComparer.OrdinalIgnoreCase);
        }

        if (!File.Exists(path))
        {
            throw new FileNotFoundException($"Agents file not found: {path}");
        }

        var json = File.ReadAllText(path, Encoding.UTF8);
        return LoadFromJson(json);
    }

    private static IReadOnlyDictionary<string, Agent> LoadFromJson(string json)
    {
        using var doc = JsonDocument.Parse(json);
        JsonElement root = doc.RootElement;

        if (root.ValueKind == JsonValueKind.Object && root.TryGetProperty("agents", out var agentsProp))
        {
            root = agentsProp;
        }

        if (root.ValueKind != JsonValueKind.Array)
        {
            throw new InvalidOperationException("Agents file must be a JSON array or { agents: [...] }.");
        }

        var options = new JsonSerializerOptions
        {
            PropertyNameCaseInsensitive = true
        };

        var items = JsonSerializer.Deserialize<AgentFileItem[]>(root.GetRawText(), options) ?? Array.Empty<AgentFileItem>();
        var dict = new Dictionary<string, Agent>(StringComparer.OrdinalIgnoreCase);

        foreach (var item in items)
        {
            if (string.IsNullOrWhiteSpace(item.Code)) continue;

            var name = string.IsNullOrWhiteSpace(item.Name) ? item.Code.Trim() : item.Name.Trim();
            var systemPrompt = !string.IsNullOrWhiteSpace(item.SystemPrompt)
                ? item.SystemPrompt.Trim()
                : BuildSystemPrompt(name, item.Description, item.Capabilities);

            dict[item.Code.Trim()] = new Agent(item.Code.Trim(), name, systemPrompt);
        }

        return dict;
    }

    private static string BuildSystemPrompt(string name, string? description, IReadOnlyList<string>? capabilities)
    {
        var sb = new StringBuilder();
        sb.Append("Sen bir ");
        sb.Append(name);
        sb.AppendLine(" ajansın.");

        if (!string.IsNullOrWhiteSpace(description))
        {
            sb.AppendLine();
            sb.AppendLine("Açıklama:");
            sb.AppendLine(description.Trim());
        }

        var caps = (capabilities ?? Array.Empty<string>())
            .Select(c => (c ?? string.Empty).Trim())
            .Where(c => !string.IsNullOrWhiteSpace(c))
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToArray();

        if (caps.Length > 0)
        {
            sb.AppendLine();
            sb.AppendLine("Neler yaparsın:");
            foreach (var c in caps)
            {
                sb.Append("- ");
                sb.AppendLine(c);
            }
        }

        sb.AppendLine();
        sb.AppendLine("Kurallar:");
        sb.AppendLine("- Kısa, net ve uygulanabilir cevap ver.");
        sb.AppendLine("- Belirsizlik varsa varsayımı belirt ve seçenek sun.");

        return sb.ToString().Trim();
    }

    private sealed class AgentFileItem
    {
        public string Code { get; set; } = string.Empty;
        public string? Name { get; set; }
        public string? Description { get; set; }
        public string[]? Capabilities { get; set; }
        public string? SystemPrompt { get; set; }
    }
}

