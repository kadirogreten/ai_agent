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
