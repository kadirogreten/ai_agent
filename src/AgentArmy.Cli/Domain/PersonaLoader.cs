namespace AgentArmy.Cli;

/// <summary>
/// Persona content yükleyici — DB-first, dosya fallback.
/// Tek hakikat kaynağı Supabase personas tablosu; disk eski içerikler için yedek.
/// </summary>
public static class PersonaLoader
{
    /// <summary>
    /// Persona içeriğini (system prompt + persona bağlamı) düz metin olarak döner.
    /// DB'de bulunamazsa repo'daki personas/{slug}.md dosyasına bakar.
    /// </summary>
    public static async Task<string> LoadTextAsync(
        string rootDir,
        DomainPack? domainPack,
        string personaSlug,
        LocalConfig.SupabaseConfigSection? supabase = null,
        CancellationToken ct = default)
    {
        if (string.IsNullOrWhiteSpace(personaSlug))
            return string.Empty;

        // 1. DB önce
        if (supabase?.IsConfigured == true && domainPack is not null)
        {
            try
            {
                var content = await DomainPackDbLoader.TryLoadPersonaMdAsync(
                    supabase, domainPack.Id, personaSlug, ct);
                if (!string.IsNullOrWhiteSpace(content)) return content!;
            }
            catch (Exception ex)
            {
                Console.Error.WriteLine(
                    $"[PersonaLoader] DB'den yükleme başarısız ({personaSlug}), dosyaya fallback: {ex.Message}");
            }
        }

        // 2. Disk fallback (repo'daki personas/{slug}.md)
        var path = Path.Combine(rootDir, "personas", personaSlug + ".md");
        if (File.Exists(path))
            return File.ReadAllText(path);

        return $"Persona içeriği bulunamadı: {personaSlug}";
    }
}
