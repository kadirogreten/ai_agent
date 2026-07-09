using System.Text.Json;

namespace AgentArmy.Cli;

/// <summary>
/// PR10: llm_providers tablosundan purpose'a göre provider çözer.
/// DB yoksa env-tabanlı hardcoded fallback döner.
/// PostgREST dizi-içerir: is_default_for=cs.{purpose}
/// </summary>
public static class LlmProviderResolver
{
    /// <summary>DB bulunamazsa veya kayıt yoksa kullanılan fallback.</summary>
    public static readonly LlmProviderRecord Fallback = new(
        Slug:            "gpt-4.1-fallback",
        DisplayName:     "GPT-4.1 (env fallback)",
        ApiBase:         "https://api.openai.com",
        ApiKeyEnv:       "OPENAI_API_KEY",
        ModelId:         Environment.GetEnvironmentVariable("OPENAI_MODEL") ?? "gpt-4.1",
        Kind:            "openai",
        Tier:            "standard",
        MaxDecisionRisk: "R2",
        Enabled:         true,
        IsDefaultFor:    ["run", "decide", "facts"]
    );

    /// <summary>
    /// Verilen amaç (run/decide/facts) için is_default_for kaydını çözer.
    /// DB yoksa Fallback döner; kayıt bulunamazsa Fallback + uyarı.
    /// </summary>
    public static async Task<LlmProviderRecord> ResolveAsync(
        SupabaseWriter? db, string purpose, CancellationToken ct)
    {
        if (db is null)
        {
            Console.Error.WriteLine($"[LlmProvider] {purpose}: DB yok → fallback ({Fallback.ModelId})");
            return Fallback;
        }

        try
        {
            // PostgREST dizi-içerir operatörü: cs.{purpose}
            var query = $"select=slug,display_name,api_base,api_key_env,model_id,kind,tier,max_decision_risk,enabled,is_default_for" +
                        $"&enabled=eq.true&is_default_for=cs.{{{purpose}}}&limit=1";
            var result = await db.SelectAsync("llm_providers", query, ct);

            if (result.ValueKind == JsonValueKind.Array)
            {
                foreach (var item in result.EnumerateArray())
                {
                    var record = Parse(item);
                    if (record is not null)
                    {
                        Console.Error.WriteLine($"[LlmProvider] {purpose}: {record.Slug} ({record.ModelId})");
                        return record;
                    }
                }
            }

            Console.Error.WriteLine($"[LlmProvider] {purpose}: DB'de kayıt yok → fallback ({Fallback.ModelId})");
            return Fallback;
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine($"[LlmProvider] {purpose}: çözümleme hatası ({ex.Message}) → fallback");
            return Fallback;
        }
    }

    private static LlmProviderRecord? Parse(JsonElement e)
    {
        try
        {
            var slug   = e.GetProperty("slug").GetString()           ?? "";
            var name   = e.GetProperty("display_name").GetString()   ?? slug;
            var base_  = e.GetProperty("api_base").GetString()       ?? "https://api.openai.com";
            var keyEnv = e.GetProperty("api_key_env").GetString()    ?? "OPENAI_API_KEY";
            var model  = e.GetProperty("model_id").GetString()       ?? "gpt-4.1";
            var kind   = e.GetProperty("kind").GetString()           ?? "openai";
            var tier   = e.GetProperty("tier").GetString()           ?? "standard";
            var maxR   = e.GetProperty("max_decision_risk").GetString() ?? "R2";
            var enabled = e.TryGetProperty("enabled", out var enProp) && enProp.GetBoolean();

            var defaults = Array.Empty<string>();
            if (e.TryGetProperty("is_default_for", out var idf) && idf.ValueKind == JsonValueKind.Array)
                defaults = idf.EnumerateArray()
                              .Where(x => x.ValueKind == JsonValueKind.String)
                              .Select(x => x.GetString()!)
                              .ToArray();

            return new LlmProviderRecord(slug, name, base_, keyEnv, model, kind, tier, maxR, enabled, defaults);
        }
        catch
        {
            return null;
        }
    }

    /// <summary>cost_class → llm_providers.tier eşlemesi (D1a).</summary>
    public static string CostClassToTier(string? costClass) => costClass?.ToLowerInvariant() switch
    {
        "high"   => "frontier",
        "medium" => "standard",
        _        => "basic",
    };

    /// <summary>
    /// Verilen tier için enabled provider çözer (basic/standard/frontier).
    /// Kayıt yoksa env-tabanlı <see cref="LlmRouter.ModelForCostClass"/> fallback kullanılır.
    /// </summary>
    public static async Task<LlmProviderRecord> ResolveForTierAsync(
        SupabaseWriter? db, string tier, CancellationToken ct)
    {
        var normalizedTier = tier?.ToLowerInvariant() switch
        {
            "frontier" or "standard" or "basic" => tier!.ToLowerInvariant(),
            _ => "standard",
        };

        if (db is null)
        {
            var model = normalizedTier switch
            {
                "frontier" => LlmRouter.ModelForCostClass("high"),
                "basic"    => LlmRouter.ModelForCostClass("low"),
                _          => LlmRouter.ModelForCostClass("medium"),
            };
            Console.Error.WriteLine($"[LlmProvider] tier={normalizedTier}: DB yok → env fallback ({model})");
            return Fallback with { ModelId = model, Tier = normalizedTier };
        }

        try
        {
            var query = "select=slug,display_name,api_base,api_key_env,model_id,kind,tier,max_decision_risk,enabled,is_default_for" +
                        $"&enabled=eq.true&tier=eq.{Uri.EscapeDataString(normalizedTier)}&limit=1";
            var result = await db.SelectAsync("llm_providers", query, ct);

            if (result.ValueKind == JsonValueKind.Array)
            {
                foreach (var item in result.EnumerateArray())
                {
                    var record = Parse(item);
                    if (record is not null)
                    {
                        Console.Error.WriteLine($"[LlmProvider] tier={normalizedTier}: {record.Slug} ({record.ModelId})");
                        return record;
                    }
                }
            }

            var fallbackModel = normalizedTier switch
            {
                "frontier" => LlmRouter.ModelForCostClass("high"),
                "basic"    => LlmRouter.ModelForCostClass("low"),
                _          => LlmRouter.ModelForCostClass("medium"),
            };
            Console.Error.WriteLine($"[LlmProvider] tier={normalizedTier}: DB'de kayıt yok → env fallback ({fallbackModel})");
            return Fallback with { ModelId = fallbackModel, Tier = normalizedTier };
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine($"[LlmProvider] tier={normalizedTier}: çözümleme hatası ({ex.Message}) → fallback");
            return Fallback with { Tier = normalizedTier };
        }
    }

    /// <summary>Risk seviyesini karşılaştırmak için sayısal değer. R0=0 … R3=3.</summary>
    public static int RiskLevel(string r) => r?.ToUpperInvariant() switch
    {
        "R0" => 0, "R1" => 1, "R2" => 2, "R3" => 3, _ => 0
    };
}
