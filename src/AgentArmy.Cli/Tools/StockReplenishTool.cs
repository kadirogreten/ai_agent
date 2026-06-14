using System.Text.Json;
using System.Text.RegularExpressions;

namespace AgentArmy.Cli;

// Tedarik otomasyonu — stok yenileme aracı (write, R1, reversible).
//
// Teslim onaylanan sipariş için stock_levels.current_stock += quantity.
// Normal ToolExecutor + RiskGate + invocation kaydından geçer (cargo_track gibi
// read araçlara gömülü yan etki değil; ayrı tool çağrısı).
//
// Compensation: adjust_stock(-qty) — stok iptal edilince geri alınır.

public sealed class StockReplenishTool : ITool, ICompensable
{
    public string Slug => "stock_replenish";

    private static readonly JsonElement InputSchemaJson = Schema("""
    {
      "type": "object",
      "required": ["product", "quantity"],
      "properties": {
        "product":         { "type": "string",  "description": "Ürün adı (stock_levels.product ile eşleşmeli)" },
        "quantity":        { "type": "integer",  "minimum": 1, "description": "Teslim edilen adet" },
        "order_id":        { "type": "string",  "description": "İlgili sipariş ID (izlenebilirlik için)" },
        "tracking_number": { "type": "string",  "description": "Kargo takip numarası (izlenebilirlik için)" }
      }
    }
    """);

    private static readonly JsonElement OutputSchemaJson = Schema("""
    {
      "type": "object",
      "properties": {
        "product":          { "type": "string" },
        "quantity_added":   { "type": "integer" },
        "order_id":         { "type": "string" },
        "tracking_number":  { "type": "string" },
        "stock_updated":    { "type": "boolean" },
        "replenished_at":   { "type": "string" }
      }
    }
    """);

    public ToolDescriptor Descriptor => new()
    {
        Slug         = Slug,
        Name         = "Stok Yenile",
        Description  = "Teslim edilen sipariş için stoğu artırır (adjust_stock RPC). write/R1 — RiskGate kaydından geçer.",
        Category     = "inventory",
        SideEffect   = ToolSideEffect.Write,
        Reversible   = true,
        MinRisk      = "R1",
        InputSchema  = InputSchemaJson,
        OutputSchema = OutputSchemaJson,
    };

    public async Task<ToolResult> InvokeAsync(JsonElement args, RunContext ctx, CancellationToken ct)
    {
        if (args.ValueKind != JsonValueKind.Object ||
            !args.TryGetProperty("product", out var pEl) || pEl.ValueKind != JsonValueKind.String ||
            string.IsNullOrWhiteSpace(pEl.GetString()))
            return ToolResult.Failure(Slug, "Zorunlu 'product' argümanı (string) eksik.");

        if (!args.TryGetProperty("quantity", out var qEl) || qEl.ValueKind != JsonValueKind.Number ||
            !qEl.TryGetInt32(out var quantity) || quantity < 1)
            return ToolResult.Failure(Slug, "Zorunlu 'quantity' argümanı (>=1 tamsayı) eksik/geçersiz.");

        var productRaw     = pEl.GetString()!.Trim();
        var orderId        = args.TryGetProperty("order_id",        out var oEl) && oEl.ValueKind == JsonValueKind.String ? oEl.GetString() : null;
        var trackingNumber = args.TryGetProperty("tracking_number", out var tEl) && tEl.ValueKind == JsonValueKind.String ? tEl.GetString() : null;

        // Teslim onaylama guard: tracking_number Unix suffix içeriyorsa sipariş zamanından beri
        // geçen süreyi cargo.stage_minutes politikasıyla karşılaştır; teslim olmamışsa reddet.
        if (!string.IsNullOrWhiteSpace(trackingNumber))
        {
            var delivered = await IsDeliveredAsync(ctx, trackingNumber, ct);
            if (!delivered)
                return ToolResult.Failure(Slug,
                    $"Sipariş henüz teslim edilmedi — stok güncellenmedi (takip: {trackingNumber}). " +
                    "Kargo teslim edildikten sonra tekrar deneyin.");
        }

        // order_id idempotency: aynı sipariş için önceki başarılı replenish varsa tekrarlama.
        if (!string.IsNullOrWhiteSpace(orderId) && ctx.Db is not null && !string.IsNullOrWhiteSpace(ctx.OwnerId))
        {
            var alreadyDone = await IsReplenishedAsync(ctx, ctx.OwnerId!, orderId!, ct);
            if (alreadyDone)
            {
                Console.Error.WriteLine($"[stock_replenish] idempotency: order_id {orderId} zaten işlendi");
                return ToolResult.Success(Slug, JsonSerializer.SerializeToElement(new
                {
                    product = productRaw,
                    quantity_added  = quantity,
                    order_id        = orderId,
                    tracking_number = trackingNumber,
                    stock_updated   = false,
                    idempotent      = true,
                    replenished_at  = DateTimeOffset.UtcNow.ToString("o"),
                }));
            }
        }

        // Ürün eşleşmesi (R6): SKU deseni → canonical product adı çöz, yoksa ILIKE ile devam.
        var product = productRaw;
        if (ctx.Db is not null && !string.IsNullOrWhiteSpace(ctx.OwnerId))
        {
            var skuMatch = SkuRegex.Match(productRaw);
            if (skuMatch.Success)
            {
                var resolved = await ResolveProductNameAsync(ctx, ctx.OwnerId!, skuMatch.Value, ct);
                if (resolved is not null) product = resolved;
            }
        }

        var stockUpdated = false;
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
                stockUpdated = true;
                Console.Error.WriteLine($"[stock_replenish] stok güncellendi: {product} +{quantity}");
            }
            catch (Exception ex)
            {
                Console.Error.WriteLine($"[stock_replenish] adjust_stock hatası: {ex.Message}");
                return ToolResult.Failure(Slug, $"Stok güncellenemedi: {ex.Message}");
            }
        }
        else
        {
            // Null-DB: test/dev modunda no-op (logla, başarı döndür).
            Console.Error.WriteLine($"[stock_replenish] null-DB — stok güncellemesi atlandı: {product} +{quantity}");
            stockUpdated = false;
        }

        var output = JsonSerializer.SerializeToElement(new
        {
            product,
            quantity_added   = quantity,
            order_id         = orderId,
            tracking_number  = trackingNumber,
            stock_updated    = stockUpdated,
            replenished_at   = DateTimeOffset.UtcNow.ToString("o"),
        });

        // Compensation token: product + quantity için geri alma.
        var token = System.Text.Json.JsonSerializer.Serialize(new { product, quantity, order_id = orderId });
        return ToolResult.Success(Slug, output, compensationToken: token);
    }

    // ICompensable: stok geri al (adjust_stock -qty).
    public async Task<CompensationResult> CompensateAsync(string token, SupabaseWriter? db, string? ownerId, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(token))
            return CompensationResult.Failure("Boş compensation_token.");

        string? product  = null;
        int     quantity = 0;
        string? orderId  = null;
        try
        {
            using var doc = JsonDocument.Parse(token);
            var root = doc.RootElement;
            product  = root.TryGetProperty("product",  out var pr) ? pr.GetString() : null;
            quantity = root.TryGetProperty("quantity", out var q) && q.TryGetInt32(out var qi) ? qi : 0;
            orderId  = root.TryGetProperty("order_id", out var oi) ? oi.GetString() : null;
        }
        catch (Exception ex)
        {
            return CompensationResult.Failure($"Token ayrıştırılamadı: {ex.Message}");
        }

        if (string.IsNullOrWhiteSpace(product) || quantity <= 0)
            return CompensationResult.Failure("Token'da product/quantity eksik.");

        if (db is not null && !string.IsNullOrWhiteSpace(ownerId))
        {
            await db.CallRpcAsync("adjust_stock", new
            {
                p_owner   = ownerId,
                p_product = product,
                p_delta   = -quantity,
            }, ct);
            Console.Error.WriteLine($"[stock_replenish] compensation: {product} -{quantity} orderId={orderId}");
            return CompensationResult.Success($"Stok geri alındı: {product} -{quantity}");
        }

        return CompensationResult.Success($"Null-DB: stok geri alma atlandı (product={product} qty={quantity})");
    }

    // ── Yardımcılar ──────────────────────────────────────────────────────────

    private static readonly Regex SkuRegex = new(@"[A-Z]{2,}-\d+", RegexOptions.Compiled);

    private static readonly int[] DefaultStageMinutes = { 10, 25, 45, 70, 100 };

    /// <summary>
    /// Tracking number formatı "...{hash}-{unixSec}" ise sipariş zamanından beri geçen süreyi
    /// cargo.stage_minutes politikasıyla karşılaştırır. Format uyuşmazsa guard atlanır (true döner).
    /// </summary>
    private static async Task<bool> IsDeliveredAsync(RunContext ctx, string trackingNumber, CancellationToken ct)
    {
        var dashIdx = trackingNumber.LastIndexOf('-');
        if (dashIdx < 0 || dashIdx >= trackingNumber.Length - 1) return true; // format bilinmiyor → guard atla

        var suffix = trackingNumber[(dashIdx + 1)..];
        if (!long.TryParse(suffix, out var unixSec)) return true; // parse edilemiyor → atla

        var orderTime      = DateTimeOffset.FromUnixTimeSeconds(unixSec);
        var elapsedRealMin = (DateTimeOffset.UtcNow - orderTime).TotalMinutes;

        double demoScale = 1.0;
        var scaleEnv = Environment.GetEnvironmentVariable("CARGO_DEMO_SCALE");
        if (double.TryParse(scaleEnv, out var sv) && sv > 0) demoScale = sv;

        var demoMin = elapsedRealMin * demoScale;

        var stageMinutes = await PolicyReader.GetAsync(ctx.Db, ctx.OwnerId, "cargo.stage_minutes", DefaultStageMinutes, ct);
        var arr = stageMinutes is { Length: > 0 } ? stageMinutes : DefaultStageMinutes;
        var deliveryThreshold = arr[arr.Length - 1];

        return demoMin >= deliveryThreshold;
    }

    /// <summary>
    /// tool_invocations tablosunda aynı order_id için önceden başarılı stock_replenish var mı?
    /// </summary>
    private static async Task<bool> IsReplenishedAsync(RunContext ctx, string owner, string orderId, CancellationToken ct)
    {
        try
        {
            var query = $"owner_user_id=eq.{Uri.EscapeDataString(owner)}" +
                        $"&tool_slug=eq.stock_replenish" +
                        $"&status=eq.succeeded" +
                        $"&args->>order_id=eq.{Uri.EscapeDataString(orderId)}" +
                        $"&select=id&limit=1";
            var res = await ctx.Db!.SelectAsync("tool_invocations", query, ct);
            return res.ValueKind == JsonValueKind.Array && res.GetArrayLength() > 0;
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine($"[stock_replenish] idempotency kontrol hatası: {ex.Message}");
            return false; // fail-open
        }
    }

    /// <summary>SKU ile stock_levels'tan canonical product adını çözer; bulunamazsa null.</summary>
    private static async Task<string?> ResolveProductNameAsync(
        RunContext ctx, string owner, string sku, CancellationToken ct)
    {
        try
        {
            var query = $"owner_user_id=eq.{Uri.EscapeDataString(owner)}&sku=eq.{Uri.EscapeDataString(sku)}&select=product&limit=1";
            var res = await ctx.Db!.SelectAsync("stock_levels", query, ct);
            if (res.ValueKind == JsonValueKind.Array && res.GetArrayLength() > 0)
            {
                var row = res[0];
                if (row.TryGetProperty("product", out var p) && p.ValueKind == JsonValueKind.String)
                    return p.GetString();
            }
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine($"[stock_replenish] SKU çözümleme hatası ({sku}): {ex.Message}");
        }
        return null;
    }

    private static JsonElement Schema(string json)
    {
        using var doc = JsonDocument.Parse(json);
        return doc.RootElement.Clone();
    }
}
