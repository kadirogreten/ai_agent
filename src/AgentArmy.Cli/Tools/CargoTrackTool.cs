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

    public Task<ToolResult> InvokeAsync(JsonElement args, RunContext ctx, CancellationToken ct)
    {
        if (args.ValueKind != JsonValueKind.Object ||
            !args.TryGetProperty("tracking_number", out var tEl) ||
            tEl.ValueKind != JsonValueKind.String ||
            string.IsNullOrWhiteSpace(tEl.GetString()))
        {
            return Task.FromResult(ToolResult.Failure(Slug, "Zorunlu 'tracking_number' argümanı (string) eksik."));
        }

        var tracking = tEl.GetString()!.Trim();
        var carrier  = args.TryGetProperty("carrier", out var cEl) && cEl.ValueKind == JsonValueKind.String
            ? cEl.GetString()!.Trim() : "Yurtiçi Kargo";

        // Takip no'ya bağlı deterministik bir ilerleme aşaması (demo): 2..4 arası.
        var seed       = Math.Abs(tracking.GetHashCode());
        var stageIndex = 2 + seed % 3; // Kargoya verildi .. Dağıtıma çıktı
        var now        = DateTimeOffset.UtcNow;

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
                    _ => "Alıcı şubesi",
                },
                ts = now.AddHours(-(stageIndex - i) * 9).ToString("o"),
            });
        }

        var output = JsonSerializer.SerializeToElement(new
        {
            tracking_number    = tracking,
            carrier,
            status             = Stages[stageIndex],
            last_update        = now.ToString("o"),
            estimated_delivery = now.AddDays(stageIndex >= 4 ? 0 : 2).ToString("yyyy-MM-dd"),
            history,
        });

        return Task.FromResult(ToolResult.Success(Slug, output));
    }

    private static JsonElement Schema(string json)
    {
        using var doc = JsonDocument.Parse(json);
        return doc.RootElement.Clone();
    }
}
