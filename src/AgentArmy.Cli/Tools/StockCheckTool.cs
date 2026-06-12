using System.Text.Json;
using System.Text.RegularExpressions;

namespace AgentArmy.Cli;

// Tedarik otomasyonu — stok kontrol aracı.
// Salt-okuma: stok seviyesini DB'deki stock_levels tablosundan okur (DB-first; statik fixture yok).
// RiskGate'i tetiklemez. Yarın IdeaSoft/ERP API'si aynı tabloyu besleyebilir; bu araç değişmez.

public sealed class StockCheckTool : ITool
{
    public string Slug => "stock_check";

    private static readonly JsonElement InputSchemaJson = Schema("""
    {
      "type": "object",
      "required": ["product"],
      "properties": {
        "product":   { "type": "string",  "description": "Stok seviyesi sorgulanacak ürün adı" },
        "threshold": { "type": "integer", "minimum": 0, "description": "Eşik override (verilmezse DB satırındaki eşik kullanılır)" }
      }
    }
    """);

    private static readonly JsonElement OutputSchemaJson = Schema("""
    {
      "type": "object",
      "properties": {
        "product":         { "type": "string" },
        "sku":             { "type": "string" },
        "current_stock":   { "type": "integer" },
        "threshold":       { "type": "integer" },
        "target_stock":    { "type": "integer" },
        "below_threshold": { "type": "boolean" },
        "warehouse":       { "type": "string" },
        "source":          { "type": "string" },
        "checked_at":      { "type": "string" }
      }
    }
    """);

    public ToolDescriptor Descriptor => new()
    {
        Slug         = Slug,
        Name         = "Stok Kontrol",
        Description  = "Bir ürünün güncel stok seviyesini DB'den (stock_levels) okur ve yeniden sipariş eşiğinin altında olup olmadığını döner.",
        Category     = "data",
        SideEffect   = ToolSideEffect.Read,
        Reversible   = true,
        MinRisk      = "R0",
        InputSchema  = InputSchemaJson,
        OutputSchema = OutputSchemaJson,
    };

    public async Task<ToolResult> InvokeAsync(JsonElement args, RunContext ctx, CancellationToken ct)
    {
        if (args.ValueKind != JsonValueKind.Object ||
            !args.TryGetProperty("product", out var pEl) ||
            pEl.ValueKind != JsonValueKind.String ||
            string.IsNullOrWhiteSpace(pEl.GetString()))
        {
            return ToolResult.Failure(Slug, "Zorunlu 'product' argümanı (string) eksik.");
        }

        var product = pEl.GetString()!.Trim();

        if (ctx.Db is null)
            return ToolResult.Failure(Slug, "Stok kaynağı (DB) yapılandırılmamış — stock_levels okunamıyor.");

        var owner = ctx.OwnerId;
        if (string.IsNullOrWhiteSpace(owner))
            return ToolResult.Failure(Slug, "RUN_OWNER_USER_ID yok — stok satırı sahibe göre okunamıyor.");

        const string select = "select=product,sku,current_stock,threshold,target_stock,warehouse,source";

        // Eşleşme sırası (R6 dogfood fix):
        // (a) args.product içindeki SKU deseni [A-Z]{2,}-\d+ → sku=eq.{sku}
        // (b) tam ad eşleşmesi product=eq.{product}
        // (c) büyük/küçük harf duyarsız ILIKE — tek sonuç yeterliyse kabul et.
        var skuMatch = SkuRegex.Match(product);
        JsonElement? row = null;
        if (skuMatch.Success)
            row = await FindRowAsync(ctx, owner!, $"sku=eq.{Uri.EscapeDataString(skuMatch.Value)}", select, ct);
        row ??= await FindRowAsync(ctx, owner!, $"product=eq.{Uri.EscapeDataString(product)}", select, ct);
        row ??= await FindRowAsync(ctx, owner!, $"product=ilike.{Uri.EscapeDataString("%" + product + "%")}", select, ct);

        if (row is null)
            return ToolResult.Failure(Slug,
                $"'{product}' için stok kaydı yok. Portaldan stock_levels'a bu ürünü ekleyin.");

        var r = row.Value;
        var currentStock = GetInt(r, "current_stock", 0);
        var rowThreshold = GetInt(r, "threshold", 10);

        var threshold = rowThreshold;
        if (args.TryGetProperty("threshold", out var tEl) && tEl.ValueKind == JsonValueKind.Number
            && tEl.TryGetInt32(out var t) && t >= 0)
        {
            threshold = t;
        }

        var output = JsonSerializer.SerializeToElement(new
        {
            product       = GetStr(r, "product") ?? product,
            sku           = GetStr(r, "sku"),
            current_stock = currentStock,
            threshold,
            target_stock  = GetInt(r, "target_stock", 0),
            below_threshold = currentStock <= threshold,
            warehouse     = GetStr(r, "warehouse"),
            source        = GetStr(r, "source") ?? "manual",
            checked_at    = DateTimeOffset.UtcNow.ToString("o"),
        });

        return ToolResult.Success(Slug, output);
    }

    // ── Yardımcılar ──────────────────────────────────────────────────────────

    // SKU deseni: 2+ büyük harf + tire + 1+ rakam (örn. KK-001, ABCD-12)
    private static readonly Regex SkuRegex = new(@"[A-Z]{2,}-\d+", RegexOptions.Compiled);

    private static async Task<JsonElement?> FindRowAsync(
        RunContext ctx, string owner, string productFilter, string select, CancellationToken ct)
    {
        var query = $"owner_user_id=eq.{Uri.EscapeDataString(owner)}&{productFilter}&{select}&limit=1";
        var res = await ctx.Db!.SelectAsync("stock_levels", query, ct);
        if (res.ValueKind == JsonValueKind.Array && res.GetArrayLength() > 0)
            return res[0];
        return null;
    }

    private static int GetInt(JsonElement obj, string name, int fallback)
        => obj.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.Number && v.TryGetInt32(out var n)
            ? n : fallback;

    private static string? GetStr(JsonElement obj, string name)
        => obj.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() : null;

    private static JsonElement Schema(string json)
    {
        using var doc = JsonDocument.Parse(json);
        return doc.RootElement.Clone();
    }
}
