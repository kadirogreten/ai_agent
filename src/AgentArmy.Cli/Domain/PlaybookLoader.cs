namespace AgentArmy.Cli;

/// <summary>
/// Playbook yükleyici — DB-first, dosya yok.
/// İçerik tek kaynak olarak Supabase'te yaşar; repo'da playbook JSON dosyası tutulmaz.
/// </summary>
public static class PlaybookLoader
{
    /// <summary>
    /// Listeleme artık DB tarafında yapılır (DomainPackDbLoader / CeoPlanner DB sorgusu).
    /// Dosya taraması kaldırıldı; geriye uyumluluk için boş döner.
    /// </summary>
    public static IEnumerable<string> ListPlaybooks(string rootDir, DomainPack? domainPack)
        => Array.Empty<string>();

    /// <summary>
    /// DB-first playbook yükleyici. Supabase yapılandırılmış olmalıdır; dosya fallback yoktur.
    /// </summary>
    public static async Task<Playbook> LoadAsync(
        string rootDir,
        DomainPack? domainPack,
        string playbookId,
        LocalConfig.SupabaseConfigSection? supabase = null,
        CancellationToken ct = default)
    {
        if (supabase?.IsConfigured != true || domainPack is null)
            throw new InvalidOperationException(
                $"DB-first: '{playbookId}' yüklenemiyor — Supabase yapılandırılmamış veya domain pack yok. " +
                "İçerik DB'de (playbooks tablosu) tutulur; repo'da JSON yoktur.");

        var pb = await DomainPackDbLoader.TryLoadPlaybookAsync(supabase, domainPack.Id, playbookId, ct);
        if (pb is not null) return pb;

        throw new InvalidOperationException(
            $"Playbook not found: {playbookId} (pack={domainPack.Id}). Portaldan oluşturun.");
    }
}
