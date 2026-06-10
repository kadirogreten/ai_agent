using System.Text.Json;

namespace AgentArmy.Cli;

// Faz A — Tool Invocation temel modelleri.
// Tasarım: docs/faz-a-tool-invocation-tasarim.md (§3.1, §3.2)
// DB karşılığı: supabase/migrations/0027_tool_invocation.sql

/// <summary>
/// Bir aracın yan etki sınıfı. DB'deki <c>tools.side_effect</c> CHECK ile birebir eşleşir.
/// </summary>
public enum ToolSideEffect
{
    /// Hiçbir etki (saf hesaplama).
    None,
    /// Salt-okuma (web arama, sorgu). RiskGate'i tetiklemez.
    Read,
    /// Sistemde değişiklik (dosya yazma vb.). RiskGate'e tabi.
    Write,
    /// Dış sisteme dokunur (e-posta, takvim). RiskGate'e tabi.
    External,
}

public static class ToolSideEffects
{
    /// <summary>DB string değerini (none/read/write/external) enum'a çevirir; bilinmeyen → None.</summary>
    public static ToolSideEffect Parse(string? value) =>
        (value ?? "none").Trim().ToLowerInvariant() switch
        {
            "read"     => ToolSideEffect.Read,
            "write"    => ToolSideEffect.Write,
            "external" => ToolSideEffect.External,
            _          => ToolSideEffect.None,
        };

    /// <summary>Enum'u DB string değerine çevirir.</summary>
    public static string ToDbString(this ToolSideEffect effect) =>
        effect switch
        {
            ToolSideEffect.Read     => "read",
            ToolSideEffect.Write    => "write",
            ToolSideEffect.External => "external",
            _                       => "none",
        };

    /// <summary>
    /// Yan etkili mi? (write/external). Yalnız bunlar RiskGate'i tetikler;
    /// none/read otomatik geçer (tasarım §3.1).
    /// </summary>
    public static bool HasSideEffect(this ToolSideEffect effect) =>
        effect is ToolSideEffect.Write or ToolSideEffect.External;
}

/// <summary>
/// Bir aracın sözleşmesi: kimlik + giriş/çıkış şeması + yan etki + risk + geri-alınabilirlik.
/// <c>tools</c> tablosundaki satırın CLI tarafı temsilidir; LLM'e sunulacak araç tanımının kaynağıdır.
/// </summary>
public sealed record ToolDescriptor
{
    public required string Slug { get; init; }
    public required string Name { get; init; }
    public string? Description { get; init; }
    public string Category { get; init; } = "utility";

    public ToolSideEffect SideEffect { get; init; } = ToolSideEffect.None;
    public bool Reversible { get; init; }

    /// <summary>Aracın taban risk sınıfı (R0–R3). Etkin risk = max(görev riski, MinRisk).</summary>
    public string MinRisk { get; init; } = "R1";

    /// <summary>Geri-alma eylemi etiketi (ör. "delete_object"). Null = geri-alma yok.</summary>
    public string? Compensation { get; init; }

    /// <summary>JSON Schema (draft-07) — çağrı argümanlarını doğrular.</summary>
    public JsonElement InputSchema { get; init; }

    /// <summary>JSON Schema (draft-07) — araç çıktısını doğrular.</summary>
    public JsonElement OutputSchema { get; init; }

    /// <summary>
    /// Faz A güvenlik kuralı (tasarım §8.3): yan etkili + geri-alınamaz araç kullanılamaz.
    /// Yürütücü, bu false dönen aracı reddeder.
    /// </summary>
    public bool IsAllowedInPhaseA => !(SideEffect.HasSideEffect() && !Reversible);

    /// <summary>
    /// Bu çağrı için etkin risk seviyesi: görev riski ile aracın taban riskinden yüksek olanı.
    /// <see cref="RiskPolicy.Rank"/> ile kıyaslanır.
    /// </summary>
    public string EffectiveRisk(string taskRisk)
    {
        var task = NormalizeRisk(taskRisk);
        var floor = NormalizeRisk(MinRisk);
        return RiskPolicy.Rank(task) >= RiskPolicy.Rank(floor) ? task : floor;
    }

    private static string NormalizeRisk(string? risk)
    {
        var r = (risk ?? "R1").Trim().ToUpperInvariant();
        return r is "R0" or "R1" or "R2" or "R3" ? r : "R1";
    }
}

/// <summary>
/// Bir araç çağrısının sonucu. Başarılıysa <see cref="Output"/> dolar; yan etkili ve
/// geri-alınabilir bir araçsa <see cref="CompensationToken"/> ile geri-alma anahtarı taşınır.
/// </summary>
public sealed record ToolResult(
    bool Ok,
    string Slug,
    JsonElement? Output,
    string? CompensationToken,
    string? Error,
    /// <summary>
    /// FinishAsync'in istemci-taraflı ürettiği tool_invocations.id (RiskGate'teki queueId deseni).
    /// CompensateExchangesAsync bu id ile DB satırını patch'ler; null ise patch atlanır.
    /// </summary>
    string? InvocationId = null
)
{
    public static ToolResult Success(string slug, JsonElement? output = null, string? compensationToken = null, string? invocationId = null) =>
        new(true, slug, output, compensationToken, null, invocationId);

    public static ToolResult Failure(string slug, string error, string? invocationId = null) =>
        new(false, slug, null, null, error, invocationId);
}

/// <summary>
/// tool_invocations.status ile birebir. Kaydın yaşam döngüsünü temsil eder.
/// </summary>
public enum ToolInvocationStatus
{
    Pending,
    Succeeded,
    Failed,
    Blocked,
    Compensated,
}

public static class ToolInvocationStatuses
{
    public static string ToDbString(this ToolInvocationStatus status) =>
        status switch
        {
            ToolInvocationStatus.Succeeded   => "succeeded",
            ToolInvocationStatus.Failed      => "failed",
            ToolInvocationStatus.Blocked     => "blocked",
            ToolInvocationStatus.Compensated => "compensated",
            _                                => "pending",
        };
}
