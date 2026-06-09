namespace AgentArmy.Cli;

/// <summary>
/// Bundle yükleyici — DB-first, dosya yok.
/// </summary>
public static class BundleLoader
{
    /// <summary>Listeleme DB tarafında yapılır; dosya taraması kaldırıldı.</summary>
    public static IEnumerable<string> ListBundles(string repoRoot, DomainPack? domainPack)
        => Array.Empty<string>();

    /// <summary>
    /// DB-first bundle yükleyici. Supabase yapılandırılmış olmalıdır; dosya fallback yoktur.
    /// </summary>
    public static async Task<Bundle> LoadAsync(
        string repoRoot,
        DomainPack domainPack,
        string bundleId,
        LocalConfig.SupabaseConfigSection? supabase = null,
        CancellationToken ct = default)
    {
        if (supabase?.IsConfigured != true)
            throw new InvalidOperationException(
                $"DB-first: '{bundleId}' bundle'ı yüklenemiyor — Supabase yapılandırılmamış. " +
                "İçerik DB'de (playbook_bundles tablosu) tutulur.");

        var b = await DomainPackDbLoader.TryLoadBundleAsync(supabase, domainPack.Id, bundleId, ct);
        if (b is not null) return b;

        throw new InvalidOperationException(
            $"Bundle not found: {bundleId} (pack={domainPack.Id}). Portaldan oluşturun.");
    }
}
