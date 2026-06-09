namespace AgentArmy.Cli;

public sealed class DomainPack
{
    public required string Id { get; init; }
    /// <summary>Dosya tabanlı yüklemede repo kök dizini; DB'den yüklemede boş olabilir.</summary>
    public string RootDir { get; init; } = string.Empty;

    public IReadOnlyList<string> AllowedDomains { get; init; } = Array.Empty<string>();
    public string? VerifierRubric { get; init; }
    public string? GlossaryMd { get; init; }
    public string? RegulatoryNotesMd { get; init; }

    /// <summary>DB'den mi yüklendi?</summary>
    public bool LoadedFromDb { get; init; }

    public string PlaybooksDir => Path.Combine(RootDir, "domain-packs", Id, "playbooks");
}

/// <summary>
/// DB-first + dosya-fallback domain pack yükleyici.
/// DB bağlantısı varsa Supabase REST API'yi dener; yoksa veya hata alırsa
/// <c>domain-packs/{id}/</c> klasörünü okur.
/// </summary>
public static class DomainPackLoader
{
    /// <summary>
    /// Ana yükleme metodu: önce DB, sonra dosya sistemi.
    /// </summary>
    public static async Task<DomainPack?> TryLoadAsync(
        string repoRoot,
        string? id,
        LocalConfig.SupabaseConfigSection? supabase = null,
        CancellationToken ct = default)
    {
        if (string.IsNullOrWhiteSpace(id)) return null;

        // DB'den yükle — tek kaynak
        if (supabase?.IsConfigured == true)
        {
            try
            {
                return await DomainPackDbLoader.TryLoadAsync(supabase, id, ct);
            }
            catch (Exception ex)
            {
                Console.Error.WriteLine($"[DomainPackLoader] DB yüklemesi başarısız: {ex.Message}");
            }
        }

        return null;
    }

    /// <summary>
    /// Senkron yardımcı. DB-first geçişte dosya yüklemesi kaldırıldı; her zaman null döner.
    /// Pack yüklemesi için <see cref="TryLoadAsync"/> (DB) kullanılır.
    /// </summary>
    public static DomainPack? TryLoad(string repoRoot, string? id) => null;
}

