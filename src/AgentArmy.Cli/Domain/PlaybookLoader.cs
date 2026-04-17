using System.Text.Json;

namespace AgentArmy.Cli;

public static class PlaybookLoader
{
    public static IEnumerable<string> ListPlaybooks(string rootDir, DomainPack? domainPack)
    {
        var ids = new List<string>();

        var defaultDir = Path.Combine(rootDir, "playbooks");
        if (Directory.Exists(defaultDir))
        {
            ids.AddRange(
                Directory.GetFiles(defaultDir, "*.json")
                    .Select(path => Path.GetFileNameWithoutExtension(path) ?? string.Empty)
                    .Where(id => !string.IsNullOrWhiteSpace(id))
            );
        }

        if (domainPack is not null && Directory.Exists(domainPack.PlaybooksDir))
        {
            ids.AddRange(
                Directory.GetFiles(domainPack.PlaybooksDir, "*.json")
                    .Select(path => Path.GetFileNameWithoutExtension(path) ?? string.Empty)
                    .Where(id => !string.IsNullOrWhiteSpace(id))
            );
        }

        return ids
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .OrderBy(id => id);
    }

    public static Playbook Load(string rootDir, DomainPack? domainPack, string playbookId)
    {
        var path = Path.Combine(rootDir, "playbooks", playbookId + ".json");
        if (domainPack is not null)
        {
            var packPath = Path.Combine(domainPack.PlaybooksDir, playbookId + ".json");
            if (File.Exists(packPath)) path = packPath;
        }
        if (!File.Exists(path))
        {
            throw new FileNotFoundException($"Playbook not found: {playbookId}", path);
        }

        var json = File.ReadAllText(path);
        var playbook = JsonSerializer.Deserialize<Playbook>(json, new JsonSerializerOptions
        {
            PropertyNameCaseInsensitive = true
        });

        if (playbook is null)
        {
            throw new InvalidOperationException($"Invalid playbook json: {path}");
        }

        return playbook;
    }
}
