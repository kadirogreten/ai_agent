namespace AgentArmy.Cli;

/// <summary>
/// Persona yükleyici — DB-first, dosya fallback.
/// </summary>
public static class PersonaLoader
{
    /// <summary>
    /// Persona profili: markdown bağlamı + davranış/risk overlay (DB'den).
    /// </summary>
    public static async Task<PersonaProfile> LoadProfileAsync(
        string rootDir,
        DomainPack? domainPack,
        string personaSlug,
        LocalConfig.SupabaseConfigSection? supabase = null,
        CancellationToken ct = default)
    {
        if (string.IsNullOrWhiteSpace(personaSlug))
            return PersonaProfile.FromMarkdownOnly("default", string.Empty);

        // DB-first: persona içeriği yalnız DB'den (personas tablosu) gelir; dosya yok.
        if (supabase?.IsConfigured == true && domainPack is not null)
        {
            try
            {
                var profile = await DomainPackDbLoader.TryLoadPersonaProfileAsync(
                    supabase, domainPack.Id, personaSlug, ct);
                if (profile is not null)
                    return profile;
            }
            catch (Exception ex)
            {
                Console.Error.WriteLine(
                    $"[PersonaLoader] DB'den yükleme başarısız ({personaSlug}): {ex.Message}");
            }
        }

        return PersonaProfile.FromMarkdownOnly(
            personaSlug,
            $"Persona içeriği bulunamadı: {personaSlug} (DB'de yok — portaldan oluşturun).");
    }

    /// <summary>Geriye dönük: yalnızca markdown bağlamı.</summary>
    public static async Task<string> LoadTextAsync(
        string rootDir,
        DomainPack? domainPack,
        string personaSlug,
        LocalConfig.SupabaseConfigSection? supabase = null,
        CancellationToken ct = default)
    {
        var profile = await LoadProfileAsync(rootDir, domainPack, personaSlug, supabase, ct);
        return profile.ContextMarkdown;
    }
}
