using System.Text.Json;

namespace AgentArmy.Cli;

public static class BundleLoader
{
    public static IEnumerable<string> ListBundles(string repoRoot, DomainPack? domainPack)
    {
        if (domainPack is null) return Array.Empty<string>();
        var dir = Path.Combine(repoRoot, "domain-packs", domainPack.Id, "bundles");
        if (!Directory.Exists(dir)) return Array.Empty<string>();

        return Directory.GetFiles(dir, "*.json")
            .Select(p => Path.GetFileNameWithoutExtension(p) ?? string.Empty)
            .Where(id => !string.IsNullOrWhiteSpace(id))
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .OrderBy(id => id);
    }

    public static Bundle Load(string repoRoot, DomainPack domainPack, string bundleId)
    {
        var path = Path.Combine(repoRoot, "domain-packs", domainPack.Id, "bundles", bundleId + ".json");
        if (!File.Exists(path))
        {
            throw new FileNotFoundException($"Bundle not found: {bundleId}", path);
        }

        var json = File.ReadAllText(path);
        var bundle = JsonSerializer.Deserialize<Bundle>(json, new JsonSerializerOptions
        {
            PropertyNameCaseInsensitive = true
        });

        if (bundle is null)
        {
            throw new InvalidOperationException($"Invalid bundle json: {path}");
        }

        return bundle;
    }
}

