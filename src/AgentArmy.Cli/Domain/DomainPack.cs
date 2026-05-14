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

        // 1. DB denemesi
        if (supabase?.IsConfigured == true)
        {
            try
            {
                var dbPack = await DomainPackDbLoader.TryLoadAsync(supabase, id, ct);
                if (dbPack is not null) return dbPack;
            }
            catch (Exception ex)
            {
                Console.Error.WriteLine($"[DomainPackLoader] DB yüklemesi başarısız, dosyaya fallback: {ex.Message}");
            }
        }

        // 2. Dosya fallback
        return TryLoadFromFiles(repoRoot, id!);
    }

    /// <summary>
    /// Geriye dönük uyumluluk: senkron, sadece dosya sistemi.
    /// </summary>
    public static DomainPack? TryLoad(string repoRoot, string? id)
    {
        if (string.IsNullOrWhiteSpace(id)) return null;
        return TryLoadFromFiles(repoRoot, id);
    }

    private static DomainPack? TryLoadFromFiles(string repoRoot, string id)
    {
        var packRoot = Path.Combine(repoRoot, "domain-packs", id);
        if (!Directory.Exists(packRoot)) return null;

        var allowedDomainsPath = Path.Combine(packRoot, "allowed-domains.txt");
        var allowedDomains = File.Exists(allowedDomainsPath)
            ? File.ReadAllLines(allowedDomainsPath)
                .Select(l => l.Trim())
                .Where(l => !string.IsNullOrWhiteSpace(l) && !l.StartsWith("#", StringComparison.Ordinal))
                .Distinct(StringComparer.OrdinalIgnoreCase)
                .ToArray()
            : Array.Empty<string>();

        var verifierRubricPath = Path.Combine(packRoot, "rubrics", "verifier.md");
        var rubric = File.Exists(verifierRubricPath) ? File.ReadAllText(verifierRubricPath) : null;

        var glossaryPath = Path.Combine(packRoot, "glossary.md");
        var glossary = File.Exists(glossaryPath) ? File.ReadAllText(glossaryPath) : null;

        var regPath = Path.Combine(packRoot, "regulatory_notes.md");
        var regNotes = File.Exists(regPath) ? File.ReadAllText(regPath) : null;

        return new DomainPack
        {
            Id            = id,
            RootDir       = repoRoot,
            AllowedDomains = allowedDomains,
            VerifierRubric = rubric,
            GlossaryMd    = glossary,
            RegulatoryNotesMd = regNotes,
            LoadedFromDb  = false
        };
    }
}

