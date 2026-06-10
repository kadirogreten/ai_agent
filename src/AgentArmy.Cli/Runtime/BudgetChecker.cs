using System.Text.Json;

namespace AgentArmy.Cli;

// Güvenlik kilidi 2 — Bütçe kilidi.
// consume_budget RPC atomik check+increment yapar; C#'ta read-modify-write yok.
// Null-DB toleransı: db==null ise allowed=true (dev bypass, mevcut desenle tutarlı).

public static class BudgetChecker
{
    public sealed record BudgetResult(bool Allowed, string? Reason);

    /// <summary>
    /// Bütçe kontrolü + atomik artırma. purchase_order gibi parasal araçlarda
    /// args'tan çıkarılan tutarı <paramref name="amount"/> olarak geçir.
    /// Araç çağrı sayacı her çağrıda 1 artar (başarı/hata bağımsız; sayaç niyeti sayar).
    /// </summary>
    public static async Task<BudgetResult> ConsumeAsync(
        SupabaseWriter? db,
        string? ownerId,
        string scope,
        decimal amount,
        CancellationToken ct)
    {
        if (db is null || string.IsNullOrWhiteSpace(ownerId))
            return new BudgetResult(true, "no-db bypass");

        JsonElement result;
        try
        {
            result = await db.CallRpcReturningAsync("consume_budget", new
            {
                p_owner  = ownerId,
                p_scope  = scope,
                p_amount = amount,
                p_calls  = 1,
            }, ct);
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine($"[BudgetChecker] consume_budget RPC hatası: {ex.Message} — izin veriliyor.");
            return new BudgetResult(true, "rpc-error bypass");
        }

        var allowed = result.ValueKind == JsonValueKind.Object
            && result.TryGetProperty("allowed", out var a)
            && a.ValueKind == JsonValueKind.True;

        var reason = result.ValueKind == JsonValueKind.Object
            && result.TryGetProperty("reason", out var r)
            && r.ValueKind == JsonValueKind.String
            ? r.GetString() : null;

        return new BudgetResult(allowed, reason);
    }

    /// <summary>
    /// purchase_order args'ından toplam tutarı çıkarır.
    /// total > unit_price * quantity önceliğiyle; bulunamazsa 0 döner.
    /// </summary>
    public static decimal ExtractAmount(JsonElement args)
    {
        if (args.ValueKind != JsonValueKind.Object) return 0;

        if (args.TryGetProperty("total", out var t) && t.ValueKind == JsonValueKind.Number)
            return t.GetDecimal();

        decimal unitPrice = 0;
        int quantity = 1;

        if (args.TryGetProperty("unit_price", out var up) && up.ValueKind == JsonValueKind.Number)
            unitPrice = up.GetDecimal();

        if (args.TryGetProperty("quantity", out var q) && q.TryGetInt32(out var qi))
            quantity = qi;

        return Math.Round(unitPrice * quantity, 2);
    }
}
