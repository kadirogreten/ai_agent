namespace AgentArmy.Cli;

// Faz A — Tool Invocation: görev sözleşmesindeki araç izinlerinin basit-metin grameri.
// Tasarım: docs/faz-a-tool-invocation-tasarim.md (§7)
// Format:  "tools: web_search, file_store; max_calls: 6; contrarian: on"
// Geriye uyumlu: eski tekil "contrarian:on" kullanımı da doğru ayrıştırılır.

/// <summary>
/// Ayrıştırılmış araç izinleri. <see cref="AllowedTools"/> izin verilen slug kümesidir;
/// <see cref="AllowsAllTools"/> ("tools: *") tüm araçlara izin verir.
/// </summary>
public sealed record ToolPermissionsSpec(
    IReadOnlySet<string> AllowedTools,
    bool AllowsAllTools,
    int MaxCalls,
    bool Contrarian)
{
    public const int DefaultMaxCalls = 6;

    /// <summary>Boş izin: hiçbir araç çağrılamaz (en güvenli varsayılan).</summary>
    public static ToolPermissionsSpec None { get; } =
        new(new HashSet<string>(StringComparer.OrdinalIgnoreCase), false, DefaultMaxCalls, false);

    /// <summary>Verilen araç bu görevde izinli mi? (Kümeyi büyük/küçük harf duyarsız kontrol eder.)</summary>
    public bool IsToolAllowed(string slug) =>
        AllowsAllTools || AllowedTools.Contains((slug ?? string.Empty).Trim());
}

public static class ToolPermissions
{
    /// <summary>
    /// "tools: a, b; max_calls: N; contrarian: on" formatını ayrıştırır.
    /// Bilinmeyen anahtarlar yok sayılır; "tools" yoksa hiçbir araca izin verilmez.
    /// </summary>
    public static ToolPermissionsSpec Parse(string? raw)
    {
        var allowed = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var allowAll = false;
        var maxCalls = ToolPermissionsSpec.DefaultMaxCalls;
        var contrarian = false;

        if (string.IsNullOrWhiteSpace(raw))
            return new ToolPermissionsSpec(allowed, allowAll, maxCalls, contrarian);

        foreach (var segment in raw.Split(';', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries))
        {
            var idx = segment.IndexOf(':');
            if (idx < 0) continue;

            var key = segment[..idx].Trim().ToLowerInvariant();
            var val = segment[(idx + 1)..].Trim();

            switch (key)
            {
                case "tools":
                    foreach (var t in val.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries))
                    {
                        if (t == "*") { allowAll = true; continue; }
                        allowed.Add(t);
                    }
                    break;

                case "max_calls":
                    if (int.TryParse(val, out var n) && n > 0) maxCalls = n;
                    break;

                case "contrarian":
                    contrarian = val.Equals("on", StringComparison.OrdinalIgnoreCase)
                              || val.Equals("true", StringComparison.OrdinalIgnoreCase);
                    break;
            }
        }

        return new ToolPermissionsSpec(allowed, allowAll, maxCalls, contrarian);
    }
}
