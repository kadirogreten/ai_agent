using System.Text.Json;

namespace AgentArmy.Cli;

// Tedarik otomasyonu — satın alma siparişi aracı (DEMO / dummy).
// Yan etkili + DIŞ sistem: gerçek bir tedarikçiye sipariş geçmeyi temsil eder.
// MinRisk = R3 → ToolExecutor üzerinden RiskGate'e tabidir; R3 olduğu için approval_queue'ya
// yazılır ve İNSAN ONAYI alınana kadar BEKLER. Onaysız hiçbir sipariş "geçmez".
// Reversible = true (Compensation: cancel_order) → Faz A güvenlik kuralını geçer.
//
// Gerçek entegrasyon (tedarikçi sipariş API'si) sonraki fazda InvokeAsync gövdesini değiştirir;
// sözleşme ve risk sınıfı aynı kalır.

public sealed class PurchaseOrderTool : ITool
{
    public string Slug => "purchase_order";

    private static readonly JsonElement InputSchemaJson = Schema("""
    {
      "type": "object",
      "required": ["product", "quantity"],
      "properties": {
        "product":    { "type": "string",  "description": "Satın alınacak ürün adı" },
        "quantity":   { "type": "integer", "minimum": 1, "description": "Sipariş adedi" },
        "supplier":   { "type": "string",  "description": "Seçilen tedarikçi adı (araştırma adımından)" },
        "unit_price": { "type": "number",  "description": "Birim fiyat (TL). Verilmezse demo fiyatı kullanılır." },
        "currency":   { "type": "string",  "default": "TRY" },
        "note":       { "type": "string",  "description": "Opsiyonel sipariş notu" }
      }
    }
    """);

    private static readonly JsonElement OutputSchemaJson = Schema("""
    {
      "type": "object",
      "properties": {
        "order_id":           { "type": "string" },
        "status":             { "type": "string" },
        "product":            { "type": "string" },
        "quantity":           { "type": "integer" },
        "supplier":           { "type": "string" },
        "unit_price":         { "type": "number" },
        "currency":           { "type": "string" },
        "total":              { "type": "number" },
        "tracking_number":    { "type": "string" },
        "carrier":            { "type": "string" },
        "estimated_delivery": { "type": "string" },
        "placed_at":          { "type": "string" }
      }
    }
    """);

    public ToolDescriptor Descriptor => new()
    {
        Slug         = Slug,
        Name         = "Satın Alma Siparişi",
        Description  = "Seçilen ürün için tedarikçiye satın alma siparişi geçer. Yüksek riskli (R3) — insan onayı gerektirir. (Demo: gerçekçi sipariş/takip no üretir.)",
        Category     = "commerce",
        SideEffect   = ToolSideEffect.External,
        Reversible   = true,
        MinRisk      = "R3",
        Compensation = "cancel_order",
        InputSchema  = InputSchemaJson,
        OutputSchema = OutputSchemaJson,
    };

    private static readonly string[] Carriers = { "Yurtiçi Kargo", "Aras Kargo", "MNG Kargo", "PTT Kargo" };

    public Task<ToolResult> InvokeAsync(JsonElement args, RunContext ctx, CancellationToken ct)
    {
        if (args.ValueKind != JsonValueKind.Object ||
            !args.TryGetProperty("product", out var pEl) || pEl.ValueKind != JsonValueKind.String ||
            string.IsNullOrWhiteSpace(pEl.GetString()))
        {
            return Task.FromResult(ToolResult.Failure(Slug, "Zorunlu 'product' argümanı (string) eksik."));
        }
        if (!args.TryGetProperty("quantity", out var qEl) || qEl.ValueKind != JsonValueKind.Number ||
            !qEl.TryGetInt32(out var quantity) || quantity < 1)
        {
            return Task.FromResult(ToolResult.Failure(Slug, "Zorunlu 'quantity' argümanı (>=1 tamsayı) eksik/geçersiz."));
        }

        var product  = pEl.GetString()!.Trim();
        var supplier = args.TryGetProperty("supplier", out var sEl) && sEl.ValueKind == JsonValueKind.String
            ? sEl.GetString()!.Trim() : "Seçilen Tedarikçi A.Ş.";

        var currency = args.TryGetProperty("currency", out var cEl) && cEl.ValueKind == JsonValueKind.String
            ? cEl.GetString()!.Trim() : "TRY";

        var unitPrice = args.TryGetProperty("unit_price", out var upEl) && upEl.ValueKind == JsonValueKind.Number
            ? upEl.GetDouble()
            : DemoUnitPrice(product);
        unitPrice = Math.Round(unitPrice, 2);

        var total = Math.Round(unitPrice * quantity, 2);

        var now      = DateTimeOffset.UtcNow;
        var orderId  = $"PO-{now:yyyyMMdd}-{ShortHash(product + supplier + now.Ticks)}";
        var tracking = $"TR{now:yyMMdd}{Math.Abs((product + quantity).GetHashCode()) % 1_000_000:D6}";
        var carrier  = Carriers[Math.Abs(supplier.GetHashCode()) % Carriers.Length];
        var eta      = now.AddDays(2 + Math.Abs(product.GetHashCode()) % 4); // 2–5 gün

        var output = JsonSerializer.SerializeToElement(new
        {
            order_id           = orderId,
            status             = "confirmed",
            product,
            quantity,
            supplier,
            unit_price         = unitPrice,
            currency,
            total,
            tracking_number    = tracking,
            carrier,
            estimated_delivery = eta.ToString("yyyy-MM-dd"),
            placed_at          = now.ToString("o"),
        });

        // Geri-alma anahtarı: gerçek entegrasyonda cancel_order için kullanılır.
        return Task.FromResult(ToolResult.Success(Slug, output, compensationToken: orderId));
    }

    // ── Yardımcılar ──────────────────────────────────────────────────────────

    private static double DemoUnitPrice(string product)
    {
        var hash = Math.Abs(product.GetHashCode());
        // 3.00 – 53.00 TL arası deterministik birim fiyat
        return 3.0 + (hash % 5000) / 100.0;
    }

    private static string ShortHash(object o)
        => (Math.Abs(o.GetHashCode()) % 1_000_000).ToString("D6");

    private static JsonElement Schema(string json)
    {
        using var doc = JsonDocument.Parse(json);
        return doc.RootElement.Clone();
    }
}
