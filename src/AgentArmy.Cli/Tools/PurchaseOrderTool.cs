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

public sealed class PurchaseOrderTool : ITool, ICompensable
{
    public string Slug => "purchase_order";

    private static readonly JsonElement InputSchemaJson = Schema("""
    {
      "type": "object",
      "required": ["product", "quantity"],
      "properties": {
        "product":      { "type": "string",  "description": "Satın alınacak ürün adı" },
        "quantity":     { "type": "integer", "minimum": 1, "description": "Sipariş adedi" },
        "supplier":     { "type": "string",  "description": "Seçilen tedarikçi adı (araştırma adımından)" },
        "unit_price":   { "type": "number",  "description": "Birim fiyat (TL). Verilmezse demo fiyatı kullanılır." },
        "currency":     { "type": "string",  "default": "TRY" },
        "brand":        { "type": "string",  "description": "Ürün markası (örn. Asus, Faber-Castell)" },
        "model":        { "type": "string",  "description": "Tam model adı (örn. Asus VG249Q 24 inç 165Hz)" },
        "product_code": { "type": "string",  "description": "Üretici/tedarikçi ürün kodu veya SKU" },
        "product_url":  { "type": "string",  "description": "Ürünün gerçek satış sayfası URL'si (araştırmada web_search'ten gelen, uydurma değil)" },
        "specs":        { "type": "string",  "description": "Önemli teknik özellikler (örn. 24 inç, IPS, 165Hz, 1ms)" },
        "note":         { "type": "string",  "description": "Opsiyonel sipariş notu" }
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
        "brand":              { "type": "string" },
        "model":              { "type": "string" },
        "product_code":       { "type": "string" },
        "product_url":        { "type": "string" },
        "specs":              { "type": "string" },
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

    public async Task<ToolResult> InvokeAsync(JsonElement args, RunContext ctx, CancellationToken ct)
    {
        if (args.ValueKind != JsonValueKind.Object ||
            !args.TryGetProperty("product", out var pEl) || pEl.ValueKind != JsonValueKind.String ||
            string.IsNullOrWhiteSpace(pEl.GetString()))
        {
            return ToolResult.Failure(Slug, "Zorunlu 'product' argümanı (string) eksik.");
        }
        if (!args.TryGetProperty("quantity", out var qEl) || qEl.ValueKind != JsonValueKind.Number ||
            !qEl.TryGetInt32(out var quantity) || quantity < 1)
        {
            return ToolResult.Failure(Slug, "Zorunlu 'quantity' argümanı (>=1 tamsayı) eksik/geçersiz.");
        }

        var product  = pEl.GetString()!.Trim();
        var supplier = args.TryGetProperty("supplier", out var sEl) && sEl.ValueKind == JsonValueKind.String
            ? sEl.GetString()!.Trim() : "Seçilen Tedarikçi A.Ş.";

        var currency = args.TryGetProperty("currency", out var cEl) && cEl.ValueKind == JsonValueKind.String
            ? cEl.GetString()!.Trim() : "TRY";

        // Ürün detayları (araştırma adımından): marka/model/kod/link/özellik — varsa taşı.
        string? OptStr(string name) =>
            args.TryGetProperty(name, out var el) && el.ValueKind == JsonValueKind.String && el.GetString()!.Trim().Length > 0
                ? el.GetString()!.Trim() : null;
        var brand       = OptStr("brand");
        var model       = OptStr("model");
        var productCode = OptStr("product_code");
        var productUrl  = OptStr("product_url");
        var specs       = OptStr("specs");

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

        // Onaylı sipariş sonrası stoğu yenile: stock_levels.current_stock += quantity.
        // (Bu metot RiskGate'ten SONRA çalışır; yani yalnız İNSAN ONAYI alınmış siparişte tetiklenir.)
        // Gerçekte stok teslimde artar; demoda sipariş anında yeniliyoruz ki döngü kapansın
        // (stok eşik üstüne çıkar, izleyici aynı ürünü tekrar tetiklemez).
        var stockReplenished = false;
        if (ctx.Db is not null && !string.IsNullOrWhiteSpace(ctx.OwnerId))
        {
            try
            {
                await ctx.Db.CallRpcAsync("adjust_stock", new
                {
                    p_owner   = ctx.OwnerId,
                    p_product = product,
                    p_delta   = quantity,
                }, ct);
                stockReplenished = true;
            }
            catch (Exception ex)
            {
                Console.Error.WriteLine($"[purchase_order] stok güncellenemedi: {ex.Message}");
            }
        }

        var output = JsonSerializer.SerializeToElement(new
        {
            order_id           = orderId,
            status             = "confirmed",
            product,
            brand,
            model,
            product_code       = productCode,
            product_url        = productUrl,
            specs,
            quantity,
            supplier,
            unit_price         = unitPrice,
            currency,
            total,
            tracking_number    = tracking,
            carrier,
            estimated_delivery = eta.ToString("yyyy-MM-dd"),
            placed_at          = now.ToString("o"),
            stock_replenished  = stockReplenished,
        });

        // Geri-alma anahtarı: JSON token — order_id + ürün + adet.
        // cancel_order sırasında adjust_stock(-qty) çağrısı için ürün+adet gerekli.
        var tokenObj = new { order_id = orderId, product, quantity };
        var token    = JsonSerializer.Serialize(tokenObj);
        return ToolResult.Success(Slug, output, compensationToken: token);
    }

    // ICompensable: token = {"order_id":"...","product":"...","quantity":N}
    // Stoğu geri alır (adjust_stock ile -qty) ve iptal loglar.
    public async Task<CompensationResult> CompensateAsync(string token, SupabaseWriter? db, string? ownerId, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(token))
            return CompensationResult.Failure("Boş compensation_token; iptal edilecek sipariş bilinmiyor.");

        string? orderId  = null;
        string? product  = null;
        int     quantity = 0;
        try
        {
            using var doc = JsonDocument.Parse(token);
            var root = doc.RootElement;
            orderId  = root.TryGetProperty("order_id",  out var oid) ? oid.GetString() : null;
            product  = root.TryGetProperty("product",   out var pr)  ? pr.GetString()  : null;
            quantity = root.TryGetProperty("quantity",  out var q) && q.TryGetInt32(out var qi) ? qi : 0;
        }
        catch (Exception ex)
        {
            return CompensationResult.Failure($"Token ayrıştırılamadı: {ex.Message}");
        }

        if (string.IsNullOrWhiteSpace(orderId))
            return CompensationResult.Failure("Token'da order_id yok.");

        // Stok geri al: sipariş sırasında eklenen miktarı çıkar.
        if (db is not null && !string.IsNullOrWhiteSpace(ownerId) && !string.IsNullOrWhiteSpace(product) && quantity > 0)
        {
            await db.CallRpcAsync("adjust_stock", new
            {
                p_owner   = ownerId,
                p_product = product,
                p_delta   = -quantity,
            }, ct);
        }

        Console.Error.WriteLine($"[purchase_order] cancel_order orderId={orderId} product={product} qty=-{quantity}");
        return CompensationResult.Success($"İptal edildi: {orderId}");
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
