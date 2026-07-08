using System.Text.Json;

namespace AgentArmy.Cli;

// Faz A — Tool Invocation: araç soyutlaması + yürütücü arayüzü.
// Tasarım: docs/faz-a-tool-invocation-tasarim.md (§3.2)

/// <summary>
/// Tek bir aracın somut uygulaması (örn. web_scrape, file_store).
/// Davranışı koda; sözleşmesini (<see cref="ToolDescriptor"/>) kendisi tanımlar.
/// (AgentsCatalog deseni: çekirdek tanım kodda, DB override sonraki PR'da.)
/// </summary>
public interface ITool
{
    string Slug { get; }
    ToolDescriptor Descriptor { get; }

    /// <summary>Aracı verilen argümanlarla çalıştırır. İstisna fırlatmak yerine
    /// hata durumunda <see cref="ToolResult.Failure"/> dönmesi tercih edilir;
    /// yine de yürütücü beklenmeyen istisnaları yakalar.</summary>
    Task<ToolResult> InvokeAsync(JsonElement args, RunContext ctx, CancellationToken ct);
}

/// <summary>
/// RiskGate öncesi opsiyonel doğrulama (örn. reklam bütçe cap).
/// <c>null</c> dönerse pipeline devam eder; failure <see cref="ToolResult"/> gate'e düşmeden reddedilir.
/// </summary>
public interface IToolPreGate
{
    Task<ToolResult?> ValidateBeforeGateAsync(JsonElement args, RunContext ctx, CancellationToken ct);
}

/// <summary>
/// Araç çağrılarının TEK giriş noktası. Hiçbir yan etkili eylem bunun dışından geçemez
/// (tasarım §8 invariant'ı). Pipeline: çözümle → izin → Faz A güvenliği →
/// (yan etkili ise RiskGate, PR5) → invoke → kaydet.
/// </summary>
/// <summary>
/// Geri-alınabilir araçların opsiyonel arayüzü. <see cref="ToolResult.CompensationToken"/>
/// kaydedilmiş bir çağrıyı geri almak için <see cref="CompensationExecutor"/> bu arayüzü kullanır.
/// </summary>
public interface ICompensable
{
    /// <param name="token">Araç tarafından <see cref="ToolResult.CompensationToken"/> olarak üretilen geri-alma anahtarı.</param>
    /// <param name="db">Yan etkileri geri almak için DB (ör. adjust_stock); null ise DB adımı atlanır.</param>
    /// <param name="ownerId">Sahip kullanıcı kimliği; DB RPC'lerine geçirilir.</param>
    Task<CompensationResult> CompensateAsync(string token, SupabaseWriter? db, string? ownerId, CancellationToken ct);
}

/// <summary>Geri-alma işleminin sonucu.</summary>
public sealed record CompensationResult(bool Ok, string? Message)
{
    public static CompensationResult Success(string? note = null) => new(true, note);
    public static CompensationResult Failure(string error) => new(false, error);
}

/// <summary>
/// Araç çağrılarının TEK giriş noktası. Hiçbir yan etkili eylem bunun dışından geçemez
/// (tasarım §8 invariant'ı). Pipeline: çözümle → izin → Faz A güvenliği →
/// (yan etkili ise RiskGate, PR5) → invoke → kaydet.
/// </summary>
public interface IToolExecutor
{
    /// <summary>Bu ajanın ve görev sözleşmesinin bu adımda kullanabileceği araç tanımları
    /// (LLM'e sunulacak liste). İzinde olmayan veya Faz A'da yasak araçlar dahil edilmez.</summary>
    IReadOnlyList<ToolDescriptor> AvailableFor(Agent agent, TaskContract contract);

    Task<ToolResult> ExecuteAsync(string slug, JsonElement args, Agent agent, RunContext ctx, CancellationToken ct);
}
