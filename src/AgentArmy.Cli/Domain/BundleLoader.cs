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

    /// <summary>
    /// DB-first bundle yükleyici. Supabase yapılandırılmışsa önce DB'yi dener,
    /// aksi hâlde dosya sistemine fallback yapar.
    /// </summary>
    public static async Task<Bundle> LoadAsync(
        string repoRoot,
        DomainPack domainPack,
        string bundleId,
        LocalConfig.SupabaseConfigSection? supabase = null,
        CancellationToken ct = default)
    {
        if (supabase?.IsConfigured == true)
        {
            try
            {
                var b = await DomainPackDbLoader.TryLoadBundleAsync(supabase, domainPack.Id, bundleId, ct);
                if (b is not null) return b;
            }
            catch (Exception ex)
            {
                Console.Error.WriteLine(
                    $"[BundleLoader] DB'den yükleme başarısız ({bundleId}), dosyaya fallback: {ex.Message}");
            }
        }

        return Load(repoRoot, domainPack, bundleId);
    }
}

