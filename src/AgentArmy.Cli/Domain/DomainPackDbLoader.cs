using System.Net.Http.Headers;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Web;

namespace AgentArmy.Cli;

/// <summary>
/// Supabase REST API üzerinden domain pack + playbooks + bundles yükler.
/// tenant_id IS NULL (built-in) veya eşleşen tenant'ın paketlerini döner.
/// </summary>
public static class DomainPackDbLoader
{
    private static readonly JsonSerializerOptions _json = new()
    {
        PropertyNameCaseInsensitive = true,
        NumberHandling = JsonNumberHandling.AllowReadingFromString
    };

    /// <summary>
    /// Verilen pack ID için DB'den DomainPack yükler.
    /// Bulunamazsa <c>null</c> döner.
    /// </summary>
    public static async Task<DomainPack?> TryLoadAsync(
        LocalConfig.SupabaseConfigSection supabase,
        string packId,
        CancellationToken ct = default)
    {
        using var http = BuildClient(supabase);

        var url = $"{supabase.EffectiveUrl}/rest/v1/domain_packs" +
                  $"?id=eq.{Uri.EscapeDataString(packId)}" +
                  $"&status=eq.active" +
                  $"&select=id,name,description,allowed_domains,glossary_md,regulatory_notes_md,verifier_rubric_md" +
                  $"&limit=1";

        var response = await http.GetAsync(url, ct);
        response.EnsureSuccessStatusCode();

        var body = await response.Content.ReadAsStringAsync(ct);
        var rows  = JsonSerializer.Deserialize<List<DbDomainPackRow>>(body, _json);

        if (rows is null || rows.Count == 0) return null;

        var row = rows[0];
        return new DomainPack
        {
            Id                = row.Id,
            RootDir           = string.Empty,
            AllowedDomains    = row.AllowedDomains ?? Array.Empty<string>(),
            VerifierRubric    = row.VerifierRubricMd,
            GlossaryMd        = row.GlossaryMd,
            RegulatoryNotesMd = row.RegulatoryNotesMd,
            LoadedFromDb      = true
        };
    }

    /// <summary>
    /// Verilen pack ID için DB'den tüm playbook'ları yükler (built-in veya tenant'a özel).
    /// </summary>
    public static async Task<List<DbPlaybookRow>> LoadPlaybooksAsync(
        LocalConfig.SupabaseConfigSection supabase,
        string packId,
        CancellationToken ct = default)
    {
        using var http = BuildClient(supabase);

        var url = $"{supabase.EffectiveUrl}/rest/v1/playbooks" +
                  $"?pack_id=eq.{Uri.EscapeDataString(packId)}" +
                  $"&or=(tenant_id.is.null)" +
                  $"&select=slug,name,description,goal,steps,default_risk,required_tools,tags,content_json,version";

        var response = await http.GetAsync(url, ct);
        response.EnsureSuccessStatusCode();

        var body = await response.Content.ReadAsStringAsync(ct);
        return JsonSerializer.Deserialize<List<DbPlaybookRow>>(body, _json)
               ?? new List<DbPlaybookRow>();
    }

    /// <summary>
    /// Belirli bir playbook slug'ını DB'den Playbook nesnesine dönüştürür.
    /// </summary>
    public static async Task<Playbook?> TryLoadPlaybookAsync(
        LocalConfig.SupabaseConfigSection supabase,
        string packId,
        string slug,
        CancellationToken ct = default)
    {
        using var http = BuildClient(supabase);

        var url = $"{supabase.EffectiveUrl}/rest/v1/playbooks" +
                  $"?slug=eq.{Uri.EscapeDataString(slug)}" +
                  $"&pack_id=eq.{Uri.EscapeDataString(packId)}" +
                  $"&select=slug,name,description,goal,steps,default_risk,required_tools,tags,content_json,version" +
                  $"&limit=1";

        var response = await http.GetAsync(url, ct);
        response.EnsureSuccessStatusCode();

        var body = await response.Content.ReadAsStringAsync(ct);
        var rows  = JsonSerializer.Deserialize<List<DbPlaybookRow>>(body, _json);

        if (rows is null || rows.Count == 0) return null;

        return rows[0].ToPlaybook();
    }

    /// <summary>
    /// Persona tam profili: markdown bağlamı + behaviors/risk_ceiling/cost_class overlay.
    /// </summary>
    public static async Task<PersonaProfile?> TryLoadPersonaProfileAsync(
        LocalConfig.SupabaseConfigSection supabase,
        string packId,
        string slug,
        CancellationToken ct = default)
    {
        using var http = BuildClient(supabase);

        var url = $"{supabase.EffectiveUrl}/rest/v1/personas" +
                  $"?slug=eq.{Uri.EscapeDataString(slug)}" +
                  $"&or=(pack_id.eq.{Uri.EscapeDataString(packId)},pack_id.is.null)" +
                  $"&select=slug,pack_id,content_md,system_prompt,role_description,behaviors,risk_ceiling,cost_class" +
                  $"&limit=10";

        var response = await http.GetAsync(url, ct);
        response.EnsureSuccessStatusCode();

        var body = await response.Content.ReadAsStringAsync(ct);
        var rows = JsonSerializer.Deserialize<List<DbPersonaRow>>(body, _json);
        if (rows is null || rows.Count == 0) return null;

        var primary = PickPersonaRow(rows, packId);
        return primary.ToPersonaProfile(slug);
    }

    /// <summary>
    /// Geriye dönük uyumluluk için — yalnızca markdown bağlamını döner.
    /// </summary>
    public static async Task<string?> TryLoadPersonaMdAsync(
        LocalConfig.SupabaseConfigSection supabase,
        string packId,
        string slug,
        CancellationToken ct = default)
    {
        var profile = await TryLoadPersonaProfileAsync(supabase, packId, slug, ct);
        if (profile is null) return null;
        return string.IsNullOrWhiteSpace(profile.ContextMarkdown) ? null : profile.ContextMarkdown;
    }

    private static DbPersonaRow PickPersonaRow(List<DbPersonaRow> rows, string packId)
    {
        var packSpecific = rows.Find(r =>
            string.Equals(r.PackId, packId, StringComparison.OrdinalIgnoreCase));
        if (packSpecific is not null) return packSpecific;

        var crossDomain = rows.Find(r => string.IsNullOrWhiteSpace(r.PackId));
        return crossDomain ?? rows[0];
    }

    /// <summary>
    /// Belirli bir bundle slug'ını DB'den Bundle nesnesine dönüştürür.
    /// </summary>
    public static async Task<Bundle?> TryLoadBundleAsync(
        LocalConfig.SupabaseConfigSection supabase,
        string packId,
        string slug,
        CancellationToken ct = default)
    {
        using var http = BuildClient(supabase);

        var url = $"{supabase.EffectiveUrl}/rest/v1/playbook_bundles" +
                  $"?slug=eq.{Uri.EscapeDataString(slug)}" +
                  $"&pack_id=eq.{Uri.EscapeDataString(packId)}" +
                  $"&select=slug,name,description,playbook_slugs,default_risk,content_json,version" +
                  $"&limit=1";

        var response = await http.GetAsync(url, ct);
        response.EnsureSuccessStatusCode();

        var body = await response.Content.ReadAsStringAsync(ct);
        var rows = JsonSerializer.Deserialize<List<DbBundleRow>>(body, _json);
        if (rows is null || rows.Count == 0) return null;

        return rows[0].ToBundle();
    }

    // ── private helpers ──────────────────────────────────────

    private static HttpClient BuildClient(LocalConfig.SupabaseConfigSection supabase)
    {
        // Paylaşılan SocketsHttpHandler üzerine yeni HttpClient — connection pool
        // korunur; client'ın kendisi ucuz ve dispose edilebilir.
        var http = new HttpClient(HttpClientPool.SharedHandler, disposeHandler: false)
        {
            Timeout = TimeSpan.FromSeconds(60)
        };
        http.DefaultRequestHeaders.Add("apikey", supabase.EffectiveKey);
        http.DefaultRequestHeaders.Authorization =
            new AuthenticationHeaderValue("Bearer", supabase.EffectiveKey);
        http.DefaultRequestHeaders.Add("Accept", "application/json");
        return http;
    }

    // ── DB satır modelleri ───────────────────────────────────

    public sealed class DbDomainPackRow
    {
        [JsonPropertyName("id")]                   public string Id { get; set; } = "";
        [JsonPropertyName("name")]                 public string Name { get; set; } = "";
        [JsonPropertyName("description")]          public string? Description { get; set; }
        [JsonPropertyName("allowed_domains")]      public string[]? AllowedDomains { get; set; }
        [JsonPropertyName("glossary_md")]          public string? GlossaryMd { get; set; }
        [JsonPropertyName("regulatory_notes_md")]  public string? RegulatoryNotesMd { get; set; }
        [JsonPropertyName("verifier_rubric_md")]   public string? VerifierRubricMd { get; set; }
    }

    public sealed class DbPlaybookRow
    {
        [JsonPropertyName("slug")]          public string Slug { get; set; } = "";
        [JsonPropertyName("name")]          public string Name { get; set; } = "";
        [JsonPropertyName("description")]   public string? Description { get; set; }
        [JsonPropertyName("goal")]          public string? Goal { get; set; }
        [JsonPropertyName("steps")]         public JsonElement Steps { get; set; }
        [JsonPropertyName("default_risk")]  public string DefaultRisk { get; set; } = "R1";
        [JsonPropertyName("required_tools")] public string[]? RequiredTools { get; set; }
        [JsonPropertyName("tags")]          public string[]? Tags { get; set; }
        [JsonPropertyName("content_json")]  public JsonElement? ContentJson { get; set; }
        [JsonPropertyName("version")]       public int Version { get; set; } = 1;

        /// <summary>
        /// DB satırını CLI'nin <see cref="Playbook"/> tipine çevirir.
        /// content_json varsa tam JSON üzerinden deserialize eder;
        /// yoksa steps alanından parçalar.
        /// </summary>
        public Playbook ToPlaybook()
        {
            // Tam JSON varsa önce onu dene
            if (ContentJson.HasValue && ContentJson.Value.ValueKind == JsonValueKind.Object)
            {
                try
                {
                    var pb = JsonSerializer.Deserialize<Playbook>(
                        ContentJson.Value.GetRawText(),
                        new JsonSerializerOptions { PropertyNameCaseInsensitive = true });
                    if (pb is not null) return pb;
                }
                catch { /* parçalanmışa geç */ }
            }

            // Steps'i PlaybookStep listesine çevir
            List<PlaybookStep> steps;
            try
            {
                steps = JsonSerializer.Deserialize<List<PlaybookStep>>(
                    Steps.GetRawText(),
                    new JsonSerializerOptions { PropertyNameCaseInsensitive = true })
                    ?? new List<PlaybookStep>();
            }
            catch
            {
                steps = new List<PlaybookStep>();
            }

            return new Playbook
            {
                Id             = Slug,
                Title          = Name,
                DefaultPersona = "default",
                DefaultRisk    = DefaultRisk,
                Version        = Version,
                Steps          = steps
            };
        }
    }

    public sealed class DbPersonaRow
    {
        [JsonPropertyName("slug")]             public string Slug { get; set; } = "";
        [JsonPropertyName("pack_id")]          public string? PackId { get; set; }
        [JsonPropertyName("content_md")]       public string? ContentMd { get; set; }
        [JsonPropertyName("system_prompt")]    public string? SystemPrompt { get; set; }
        [JsonPropertyName("role_description")] public string? RoleDescription { get; set; }
        [JsonPropertyName("behaviors")]        public JsonElement? Behaviors { get; set; }
        [JsonPropertyName("risk_ceiling")]     public string? RiskCeiling { get; set; }
        [JsonPropertyName("cost_class")]       public string? CostClass { get; set; }

        public PersonaProfile ToPersonaProfile(string requestedSlug)
        {
            var slug     = string.IsNullOrWhiteSpace(Slug) ? requestedSlug : Slug;
            var markdown = ResolveMarkdown();
            var ceiling  = string.IsNullOrWhiteSpace(RiskCeiling) ? "R3" : RiskCeiling.Trim();

            // Önce DB'deki explicit behaviors'ı dene; boşsa persona adı/role'undan
            // heuristik overlay çıkar — sektör keşfinden gelen personaların "sessiz"
            // (sıfır overlay ile) kalmasını engeller.
            var overlay = BehaviorsJsonMapper.TryMap(Behaviors)
                          ?? PersonaBehaviorsHeuristics.Infer(slug, slug, RoleDescription);

            return new PersonaProfile(
                slug,
                markdown,
                overlay,
                ceiling,
                string.IsNullOrWhiteSpace(CostClass) ? null : CostClass.Trim());
        }

        private string ResolveMarkdown()
        {
            if (!string.IsNullOrWhiteSpace(ContentMd)) return ContentMd!;
            if (!string.IsNullOrWhiteSpace(SystemPrompt)) return SystemPrompt!;
            if (!string.IsNullOrWhiteSpace(RoleDescription)) return RoleDescription!;
            return string.Empty;
        }
    }

    public sealed class DbBundleRow
    {
        [JsonPropertyName("slug")]            public string Slug { get; set; } = "";
        [JsonPropertyName("name")]            public string Name { get; set; } = "";
        [JsonPropertyName("description")]     public string? Description { get; set; }
        [JsonPropertyName("playbook_slugs")]  public string[]? PlaybookSlugs { get; set; }
        [JsonPropertyName("default_risk")]    public string DefaultRisk { get; set; } = "R1";
        [JsonPropertyName("content_json")]    public JsonElement? ContentJson { get; set; }
        [JsonPropertyName("version")]         public int Version { get; set; } = 1;

        public Bundle ToBundle()
        {
            // Tam JSON varsa onu kullan
            if (ContentJson.HasValue && ContentJson.Value.ValueKind == JsonValueKind.Object)
            {
                try
                {
                    var b = JsonSerializer.Deserialize<Bundle>(
                        ContentJson.Value.GetRawText(),
                        new JsonSerializerOptions { PropertyNameCaseInsensitive = true });
                    if (b is not null) return b;
                }
                catch { /* manuel inşaya geç */ }
            }

            return new Bundle
            {
                Id        = Slug,
                Title     = Name,
                Playbooks = (PlaybookSlugs ?? Array.Empty<string>()).ToList()
            };
        }
    }
}
