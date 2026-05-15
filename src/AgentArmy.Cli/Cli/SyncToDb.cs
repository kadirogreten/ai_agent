using System.Text.Json;

namespace AgentArmy.Cli;

/// <summary>
/// `sync-to-db` komutu: repo'daki domain-packs/, personas/, playbooks/ içeriğini
/// Supabase'e tek seferlik kopyalar. Idempotent — aynı id'ler ON CONFLICT ile güncellenir.
/// </summary>
public static partial class CommandDispatcher
{
    private static async Task<int> SyncToDbAsync(string rootDir, CancellationToken ct)
    {
        var supabase = GetSupabase(rootDir);
        if (supabase.IsConfigured != true)
        {
            Console.Error.WriteLine("[sync-to-db] Supabase yapılandırılmamış (agentarmy.local.json). İptal.");
            return 1;
        }

        using var db = SupabaseWriter.TryCreate(supabase);
        if (db is null)
        {
            Console.Error.WriteLine("[sync-to-db] SupabaseWriter oluşturulamadı.");
            return 1;
        }

        var summary = new SyncSummary();

        // 1. Domain pack'ler (her bir domain-packs/<id>/ dizini)
        var packsDir = Path.Combine(rootDir, "domain-packs");
        if (Directory.Exists(packsDir))
        {
            foreach (var packDir in Directory.GetDirectories(packsDir))
            {
                var packId = Path.GetFileName(packDir);
                if (string.IsNullOrWhiteSpace(packId)) continue;

                await UpsertDomainPackAsync(db, packId, packDir, summary, ct);

                // Bundles
                var bundlesDir = Path.Combine(packDir, "bundles");
                if (Directory.Exists(bundlesDir))
                {
                    foreach (var bundleFile in Directory.GetFiles(bundlesDir, "*.json"))
                        await UpsertBundleAsync(db, packId, bundleFile, summary, ct);
                }

                // Pack'a özel playbooks
                var packPlaybooksDir = Path.Combine(packDir, "playbooks");
                if (Directory.Exists(packPlaybooksDir))
                {
                    foreach (var pbFile in Directory.GetFiles(packPlaybooksDir, "*.json"))
                        await UpsertPlaybookAsync(db, packId, pbFile, summary, ct);
                }
            }
        }

        // 2. Cross-domain (kök) playbooks — pack_id NULL ile gönder
        // Not: playbooks tablosu pack_id NOT NULL, bu yüzden bunları "default" pack'e atayalım.
        var rootPlaybooksDir = Path.Combine(rootDir, "playbooks");
        if (Directory.Exists(rootPlaybooksDir))
        {
            // "default" pack'i upsert et (yoksa)
            await db.InsertAsync("domain_packs", new
            {
                id = "default",
                name = "Default (cross-domain)",
                description = "Repo kökündeki playbook'ları taşıyan otomatik pack.",
                status = "active",
                allowed_domains = Array.Empty<string>()
            }, ct);
            summary.DomainPacks++;

            foreach (var pbFile in Directory.GetFiles(rootPlaybooksDir, "*.json"))
                await UpsertPlaybookAsync(db, "default", pbFile, summary, ct);
        }

        // 3. Personas — cross-domain (pack_id NULL)
        var personasDir = Path.Combine(rootDir, "personas");
        if (Directory.Exists(personasDir))
        {
            foreach (var personaFile in Directory.GetFiles(personasDir, "*.md"))
                await UpsertPersonaAsync(db, packId: null, personaFile, summary, ct);
        }

        Console.WriteLine($"[sync-to-db] Tamamlandı.");
        Console.WriteLine($"  Domain packs : {summary.DomainPacks}");
        Console.WriteLine($"  Personas     : {summary.Personas}");
        Console.WriteLine($"  Playbooks    : {summary.Playbooks}");
        Console.WriteLine($"  Bundles      : {summary.Bundles}");
        return 0;
    }

    private static async Task UpsertDomainPackAsync(
        SupabaseWriter db, string packId, string packDir, SyncSummary summary, CancellationToken ct)
    {
        var allowedDomainsPath = Path.Combine(packDir, "allowed-domains.txt");
        var allowedDomains = File.Exists(allowedDomainsPath)
            ? File.ReadAllLines(allowedDomainsPath)
                .Select(l => l.Trim())
                .Where(l => !string.IsNullOrWhiteSpace(l) && !l.StartsWith("#"))
                .ToArray()
            : Array.Empty<string>();

        var rubricPath = Path.Combine(packDir, "rubrics", "verifier.md");
        var rubric     = File.Exists(rubricPath) ? File.ReadAllText(rubricPath) : null;

        var glossaryPath = Path.Combine(packDir, "glossary.md");
        var glossary     = File.Exists(glossaryPath) ? File.ReadAllText(glossaryPath) : null;

        var regPath  = Path.Combine(packDir, "regulatory_notes.md");
        var regNotes = File.Exists(regPath) ? File.ReadAllText(regPath) : null;

        await db.InsertAsync("domain_packs", new
        {
            id                  = packId,
            name                = packId,                 // gerçek isim yoksa id
            description         = (string?)null,
            status              = "active",
            allowed_domains     = allowedDomains,
            glossary_md         = glossary,
            regulatory_notes_md = regNotes,
            verifier_rubric_md  = rubric
        }, ct);
        summary.DomainPacks++;
    }

    private static async Task UpsertPlaybookAsync(
        SupabaseWriter db, string packId, string jsonPath, SyncSummary summary, CancellationToken ct)
    {
        try
        {
            var raw = File.ReadAllText(jsonPath);
            var pb  = JsonSerializer.Deserialize<Playbook>(raw,
                new JsonSerializerOptions { PropertyNameCaseInsensitive = true });
            if (pb is null) return;

            var slug = Path.GetFileNameWithoutExtension(jsonPath);
            var contentJson = JsonSerializer.Deserialize<JsonElement>(raw);

            await db.InsertAsync("playbooks", new
            {
                slug,
                pack_id      = packId,
                name         = pb.Title,
                description  = (string?)null,
                goal         = (string?)null,
                steps        = pb.Steps,
                default_risk = string.IsNullOrWhiteSpace(pb.DefaultRisk) ? "R1" : pb.DefaultRisk,
                content_json = contentJson,
                version      = pb.ResolvedVersion
            }, ct);
            summary.Playbooks++;
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine($"[sync-to-db] playbook hata ({jsonPath}): {ex.Message}");
        }
    }

    private static async Task UpsertBundleAsync(
        SupabaseWriter db, string packId, string jsonPath, SyncSummary summary, CancellationToken ct)
    {
        try
        {
            var raw = File.ReadAllText(jsonPath);
            var b   = JsonSerializer.Deserialize<Bundle>(raw,
                new JsonSerializerOptions { PropertyNameCaseInsensitive = true });
            if (b is null) return;

            var slug         = Path.GetFileNameWithoutExtension(jsonPath);
            var contentJson  = JsonSerializer.Deserialize<JsonElement>(raw);

            await db.InsertAsync("playbook_bundles", new
            {
                slug,
                pack_id        = packId,
                name           = b.Title,
                description    = (string?)null,
                playbook_slugs = b.Playbooks,
                default_risk   = "R1",
                content_json   = contentJson,
                version        = b.ResolvedVersion
            }, ct);
            summary.Bundles++;
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine($"[sync-to-db] bundle hata ({jsonPath}): {ex.Message}");
        }
    }

    private static async Task UpsertPersonaAsync(
        SupabaseWriter db, string? packId, string mdPath, SyncSummary summary, CancellationToken ct)
    {
        try
        {
            var content = File.ReadAllText(mdPath);
            var slug    = Path.GetFileNameWithoutExtension(mdPath);

            // İlk satırdaki "# Persona: X" başlığını name olarak kullan
            var firstHeader = content.Split('\n').FirstOrDefault(l => l.StartsWith("#"))?.TrimStart('#', ' ');
            var name        = string.IsNullOrWhiteSpace(firstHeader) ? slug : firstHeader.Trim();

            await db.InsertAsync("personas", new
            {
                slug,
                pack_id          = packId,
                name,
                role_description = (string?)null,
                system_prompt    = (string?)null,
                content_md       = content,
                risk_ceiling     = "R2",
                cost_class       = "medium"
            }, ct);
            summary.Personas++;
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine($"[sync-to-db] persona hata ({mdPath}): {ex.Message}");
        }
    }

    private sealed class SyncSummary
    {
        public int DomainPacks { get; set; }
        public int Personas    { get; set; }
        public int Playbooks   { get; set; }
        public int Bundles     { get; set; }
    }
}
