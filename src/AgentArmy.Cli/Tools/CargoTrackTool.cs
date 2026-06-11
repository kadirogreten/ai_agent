using System.Text.Json;

namespace AgentArmy.Cli;

// Tedarik otomasyonu — kargo takip aracı (DEMO / dummy).
// Salt-okuma: bir takip numarasının güncel durumunu ve hareket geçmişini döner.
// RiskGate'i tetiklemez. Gerçek entegrasyon (kargo firması / birleşik takip API'si)
// sonraki fazda InvokeAsync gövdesini değiştirir; sözleşme aynı kalır.

public sealed class CargoTrackTool : ITool
{
    public string Slug => "cargo_track";

    private static readonly JsonElement InputSchemaJson = Schema("""
    {
      "type": "object",
      "required": ["tracking_number"],
      "properties": {
        "tracking_number": { "type": "string", "description": "Kargo takip numarası (purchase_order çıktısından)" },
        "carrier":         { "type": "string", "description": "Opsiyonel kargo firması adı" }
      }
    }
    """);

    private static readonly JsonElement OutputSchemaJson = Schema("""
    {
      "type": "object",
      "properties": {
        "tracking_number":    { "type": "string" },
        "carrier":            { "type": "string" },
        "status":             { "type": "string" },
        "last_update":        { "type": "string" },
        "estimated_delivery": { "type": "string" },
        "history":            { "type": "array" }
      }
    }
    """);

    public ToolDescriptor Descriptor => new()
    {
        Slug         = Slug,
        Name         = "Kargo Takip",
        Description  = "Verilen takip numarasının güncel kargo durumunu ve hareket geçmişini döner (demo veri kaynağı).",
        Category     = "logistics",
        SideEffect   = ToolSideEffect.Read,
        Reversible   = true,
        MinRisk      = "R1",
        InputSchema  = InputSchemaJson,
        OutputSchema = OutputSchemaJson,
    };

    private static readonly string[] Stages =
    {
        "Sipariş alındı",
        "Hazırlanıyor",
        "Kargoya verildi",
        "Transfer merkezinde",
        "Dağıtıma çıktı",
        "Teslim edildi",
    };

    // CARGO_DEMO_SCALE: gerçek dakika başına kaç "demo dakika" ilerleneceği.
    // Varsayılan 1 (gerçek zamanlı: teslim 100 dk+).
    // Duman testi için: CARGO_DEMO_SCALE=60 → 1 gerçek dk = 60 demo dk (teslim ~2 gerçek dk'da).
    private static double DemoScale =>
        double.TryParse(Environment.GetEnvironmentVariable("CARGO_DEMO_SCALE"), out var v) && v > 0 ? v : 1.0;

    // Varsayılan aşama eşikleri (demo dakika cinsinden, azalan sıra)
    private static readonly int[] DefaultStageMinutes = { 10, 25, 45, 70, 100 };

    private static (int Threshold, int Stage)[] BuildThresholds(int[] minutes)
    {
        // minutes[i] = i+1. aşama için eşik dakikası (artan sıra beklenir)
        // Döndürülen dizi azalan eşik sırası (TryParseStageFromTracking için)
        var result = new (int, int)[minutes.Length + 1];
        for (var i = minutes.Length - 1; i >= 0; i--)
            result[minutes.Length - 1 - i] = (minutes[i], i + 1);
        result[minutes.Length] = (0, 0);
        return result;
    }

    public async Task<ToolResult> InvokeAsync(JsonElement args, RunContext ctx, CancellationToken ct)
    {
        if (args.ValueKind != JsonValueKind.Object ||
            !args.TryGetProperty("tracking_number", out var tEl) ||
            tEl.ValueKind != JsonValueKind.String ||
            string.IsNullOrWhiteSpace(tEl.GetString()))
        {
            return ToolResult.Failure(Slug, "Zorunlu 'tracking_number' argümanı (string) eksik.");
        }

        var tracking = tEl.GetString()!.Trim();
        var carrier  = args.TryGetProperty("carrier", out var cEl) && cEl.ValueKind == JsonValueKind.String
            ? cEl.GetString()!.Trim() : "Yurtiçi Kargo";

        var now = DateTimeOffset.UtcNow;

        // Aşama eşiklerini policy_settings'ten yükle; hata/eksik → varsayılan kullan.
        var stageMinutes = await PolicyReader.GetAsync(ctx.Db, ctx.OwnerId, "cargo.stage_minutes", DefaultStageMinutes, ct);
        var thresholds   = BuildThresholds(stageMinutes is { Length: > 0 } ? stageMinutes : DefaultStageMinutes);

        // Tracking numarasındaki Unix saniyesini parse et (PurchaseOrderTool formatı: "...{hash}-{unixSec}").
        // Parse başarısız → hash tabanlı fallback (eski format geriye uyumluluk).
        var stageIndex = TryParseStageFromTracking(tracking, now, thresholds);

        var history = new List<object>();
        for (var i = 0; i <= stageIndex; i++)
        {
            history.Add(new
            {
                stage    = Stages[i],
                location = i switch
                {
                    0 => "Satıcı deposu",
                    1 => "Satıcı deposu",
                    2 => "İstanbul Aktarma",
                    3 => "Ankara Transfer Merkezi",
                    4 => "Alıcı şubesi",
                    _ => "Alıcı adresi",
                },
                ts = now.AddMinutes(-(stageIndex - i) * 20).ToString("o"),
            });
        }

        var delivered = stageIndex >= 5;
        var output = JsonSerializer.SerializeToElement(new
        {
            tracking_number    = tracking,
            carrier,
            status             = Stages[stageIndex],
            delivered,
            last_update        = now.ToString("o"),
            estimated_delivery = now.AddDays(delivered ? 0 : 1).ToString("yyyy-MM-dd"),
            history,
        });

        return ToolResult.Success(Slug, output);
    }

    private static int TryParseStageFromTracking(string tracking, DateTimeOffset now, (int Threshold, int Stage)[] thresholds)
    {
        // Format: "TR{yyMMdd}{hash6}-{unixSec}"
        var dashIdx = tracking.LastIndexOf('-');
        if (dashIdx >= 0 && dashIdx < tracking.Length - 1)
        {
            var suffix = tracking[(dashIdx + 1)..];
            if (long.TryParse(suffix, out var unixSec))
            {
                var orderTime      = DateTimeOffset.FromUnixTimeSeconds(unixSec);
                var elapsedRealMin = (now - orderTime).TotalMinutes;
                var demoMin        = elapsedRealMin * DemoScale;

                foreach (var (threshold, stage) in thresholds)
                    if (demoMin >= threshold)
                        return stage;
            }
        }

        // Fallback: hash tabanlı (eski format, 2–4 arası)
        return 2 + Math.Abs(tracking.GetHashCode()) % 3;
    }

    private static JsonElement Schema(string json)
    {
        using var doc = JsonDocument.Parse(json);
        return doc.RootElement.Clone();
    }
}
