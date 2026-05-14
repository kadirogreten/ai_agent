using System.Text.Json;
using System.Text.Json.Serialization;

namespace AgentArmy.Cli;

public sealed class LocalConfig
{
    public OpenAiConfig? OpenAI { get; set; }

    /// <summary>
    /// Supabase bağlantı ayarları.
    /// Ortam değişkenleri de kabul edilir: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ANON_KEY
    /// </summary>
    public SupabaseConfigSection? Supabase { get; set; }

    public sealed class OpenAiConfig
    {
        public string? ApiKey { get; set; }
        public string? Model { get; set; }
    }

    public sealed class SupabaseConfigSection
    {
        [JsonPropertyName("url")]
        public string? Url { get; set; }

        [JsonPropertyName("serviceRoleKey")]
        public string? ServiceRoleKey { get; set; }

        [JsonPropertyName("anonKey")]
        public string? AnonKey { get; set; }

        /// <summary>Ortam değişkenlerini de okuyarak efektif URL döner.</summary>
        public string? EffectiveUrl =>
            Url
            ?? Environment.GetEnvironmentVariable("SUPABASE_URL")
            ?? Environment.GetEnvironmentVariable("VITE_SUPABASE_URL");

        /// <summary>Önce service role, sonra anon key; ortam değişkenleri de kontrol edilir.</summary>
        public string? EffectiveKey =>
            ServiceRoleKey
            ?? Environment.GetEnvironmentVariable("SUPABASE_SERVICE_ROLE_KEY")
            ?? AnonKey
            ?? Environment.GetEnvironmentVariable("SUPABASE_ANON_KEY")
            ?? Environment.GetEnvironmentVariable("VITE_SUPABASE_ANON_KEY");

        public bool IsConfigured =>
            !string.IsNullOrWhiteSpace(EffectiveUrl) &&
            !string.IsNullOrWhiteSpace(EffectiveKey);
    }

    /// <summary>
    /// Hem dosyadan hem de ortam değişkenlerinden Supabase ayarlarını döner.
    /// </summary>
    public SupabaseConfigSection GetSupabase() =>
        Supabase ?? new SupabaseConfigSection();

    public static LocalConfig? TryLoad(string rootDir)
    {
        var path = Path.Combine(rootDir, "agentarmy.local.json");
        if (!File.Exists(path)) return null;

        var json = File.ReadAllText(path);
        return JsonSerializer.Deserialize<LocalConfig>(json, new JsonSerializerOptions
        {
            PropertyNameCaseInsensitive = true
        });
    }
}

