namespace AgentArmy.Cli;

/// <summary>
/// Persona yükleyici — DB-first, dosya fallback.
/// Tek hakikat kaynağı Supabase personas tablosu; disk eski içerikler için yedek.
/// </summary>
public static class PersonaLoader
{
    /// <summary>
    /// Persona'yı behaviors + risk_ceiling dahil tam nesne olarak döner.
    /// DB'de bulunamazsa disk fallback ile ContentMd dolu, behaviors boş bir Persona döner.
    /// </summary>
    public static async Task<Persona> LoadAsync(
        string rootDir,
        DomainPack? domainPack,
        string personaSlug,
        LocalConfig.SupabaseConfigSection? supabase = null,
        CancellationToken ct = default)
    {
        if (string.IsNullOrWhiteSpace(personaSlug))
            return new Persona(string.Empty, string.Empty);

        // 1. DB önce
        if (supabase?.IsConfigured == true && domainPack is not null)
        {
            try
            {
                var persona = await DomainPackDbLoader.TryLoadPersonaAsync(
                    supabase, domainPack.Id, personaSlug, ct);
                if (persona is not null) return persona;
            }
            catch (Exception ex)
            {
                Console.Error.WriteLine(
                    $"[PersonaLoader] DB'den yükleme başarısız ({personaSlug}), dosyaya fallback: {ex.Message}");
            }
        }

        // 2. Disk fallback (repo'daki personas/{slug}.md) — behaviors yok
        var path = Path.Combine(rootDir, "personas", personaSlug + ".md");
        var contentMd = File.Exists(path)
            ? File.ReadAllText(path)
            : $"Persona içeriği bulunamadı: {personaSlug}";

        return new Persona(personaSlug, contentMd);
    }

    /// <summary>
    /// Geriye dönük uyumluluk için — sadece metin döner. Yeni kod <see cref="LoadAsync"/> kullanmalı.
    /// </summary>
    public static async Task<string> LoadTextAsync(
        string rootDir,
        DomainPack? domainPack,
        string personaSlug,
        LocalConfig.SupabaseConfigSection? supabase = null,
        CancellationToken ct = default)
    {
        var persona = await LoadAsync(rootDir, domainPack, personaSlug, supabase, ct);
        return persona.ContentMd;
    }
}
