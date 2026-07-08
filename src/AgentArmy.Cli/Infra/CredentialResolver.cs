using System.Text.Json;

namespace AgentArmy.Cli;

/// <summary>
/// PR-S7a: Platform-agnostik bearer token çözümleyici.
/// Önce user_social_accounts (decrypt), yoksa auth_env / platform fallback env.
/// Token asla loglanmaz.
/// </summary>
public sealed class CredentialResolver
{
    private readonly SupabaseWriter _db;

    public CredentialResolver(SupabaseWriter db) => _db = db;

    public async Task<string?> ResolveBearerAsync(
        string? ownerUserId,
        string platform,
        string? fallbackEnvVar,
        CancellationToken ct)
    {
        if (!string.IsNullOrWhiteSpace(ownerUserId))
        {
            try
            {
                var filter =
                    $"owner_user_id=eq.{Uri.EscapeDataString(ownerUserId)}" +
                    $"&platform=eq.{Uri.EscapeDataString(platform)}" +
                    "&status=eq.active" +
                    "&select=access_token_ciphertext,expires_at" +
                    "&order=updated_at.desc&limit=1";

                var json = await _db.SelectAsync("user_social_accounts", filter, ct);
                if (json.ValueKind == JsonValueKind.Array && json.GetArrayLength() > 0)
                {
                    var row = json[0];
                    var cipher = GetStr(row, "access_token_ciphertext");
                    if (!string.IsNullOrWhiteSpace(cipher))
                    {
                        try
                        {
                            var plain = TokenEncryptor.Decrypt(cipher);
                            if (!string.IsNullOrWhiteSpace(plain))
                                return plain;
                        }
                        catch (Exception ex)
                        {
                            Console.Error.WriteLine(
                                $"[CredentialResolver] Token çözülemedi (platform={platform}): {ex.Message}");
                        }
                    }
                }
            }
            catch (Exception ex)
            {
                Console.Error.WriteLine($"[CredentialResolver] DB sorgusu başarısız: {ex.Message}");
            }
        }

        var envName = !string.IsNullOrWhiteSpace(fallbackEnvVar)
            ? fallbackEnvVar
            : PlatformCredentialMap.FallbackEnvForPlatform(platform);

        return envName is not null ? Environment.GetEnvironmentVariable(envName) : null;
    }

    private static string? GetStr(JsonElement el, string prop)
        => el.TryGetProperty(prop, out var v) && v.ValueKind == JsonValueKind.String
            ? v.GetString() : null;
}
