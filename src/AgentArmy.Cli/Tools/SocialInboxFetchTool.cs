using System.Text.Json;

namespace AgentArmy.Cli;

// Sosyal medya — inbox okuma aracı (DEMO).
// Salt-okuma: platform bazlı yorum/DM/mention listesi döner (deterministik seed).
// RiskGate'i tetiklemez.

public sealed class SocialInboxFetchTool : ITool
{
    public string Slug => "social_inbox_fetch";

    private static readonly JsonElement InputSchemaJson = Schema("""
    {
      "type": "object",
      "required": ["platform"],
      "properties": {
        "platform": { "type": "string", "enum": ["facebook", "instagram", "x"], "description": "Sosyal platform" },
        "since":    { "type": "string", "description": "Opsiyonel ISO-8601 tarih filtresi" }
      }
    }
    """);

    private static readonly JsonElement OutputSchemaJson = Schema("""
    {
      "type": "object",
      "properties": {
        "platform": { "type": "string" },
        "items":    { "type": "array" },
        "fetched_at": { "type": "string" }
      }
    }
    """);

    public ToolDescriptor Descriptor => new()
    {
        Slug         = Slug,
        Name         = "Sosyal Inbox Çek",
        Description  = "Platformdaki yeni yorum, DM ve mention listesini döner (demo veri).",
        Category     = "communication",
        SideEffect   = ToolSideEffect.Read,
        Reversible   = true,
        MinRisk      = "R0",
        InputSchema  = InputSchemaJson,
        OutputSchema = OutputSchemaJson,
    };

    public Task<ToolResult> InvokeAsync(JsonElement args, RunContext ctx, CancellationToken ct)
    {
        if (args.ValueKind != JsonValueKind.Object ||
            !args.TryGetProperty("platform", out var pEl) ||
            pEl.ValueKind != JsonValueKind.String ||
            string.IsNullOrWhiteSpace(pEl.GetString()))
        {
            return Task.FromResult(ToolResult.Failure(Slug, "Zorunlu 'platform' argümanı (facebook|instagram|x) eksik."));
        }

        var platform = pEl.GetString()!.Trim().ToLowerInvariant();
        if (platform is not ("facebook" or "instagram" or "x"))
            return Task.FromResult(ToolResult.Failure(Slug, $"Desteklenmeyen platform: {platform}"));

        var prefix = platform switch
        {
            "facebook"  => "fb",
            "instagram" => "ig",
            _           => "x",
        };

        var items = new object[]
        {
            new
            {
                item_id    = $"{prefix}-cmt-001",
                type       = "comment",
                text       = "Ürün ne zaman kargoya verilir?",
                author     = "ayse_k",
                created_at = "2026-07-07T08:15:00Z",
                triage     = "yanıtla",
            },
            new
            {
                item_id    = $"{prefix}-dm-002",
                type       = "dm",
                text       = "Fiyat listesini paylaşır mısınız?",
                author     = "mehmet_y",
                created_at = "2026-07-07T09:30:00Z",
                triage     = "yanıtla",
            },
            new
            {
                item_id    = $"{prefix}-mnt-003",
                type       = "mention",
                text       = "👍",
                author     = "spam_bot_99",
                created_at = "2026-07-07T10:00:00Z",
                triage     = "yoksay",
            },
            new
            {
                item_id    = $"{prefix}-cmt-004",
                type       = "comment",
                text       = "Avukatımızla görüşeceğiz, yasal işlem başlatıyoruz.",
                author     = "anon_user",
                created_at = "2026-07-07T11:45:00Z",
                triage     = "eskale",
            },
            new
            {
                item_id    = $"{prefix}-dm-005",
                type       = "dm",
                text       = "Kampanya kodu çalışmıyor, yardım eder misiniz?",
                author     = "zeynep_a",
                created_at = "2026-07-07T12:20:00Z",
                triage     = "yanıtla",
            },
        };

        var output = JsonSerializer.SerializeToElement(new
        {
            platform,
            items,
            fetched_at = "2026-07-07T12:00:00Z",
        });

        return Task.FromResult(ToolResult.Success(Slug, output));
    }

    private static JsonElement Schema(string json)
    {
        using var doc = JsonDocument.Parse(json);
        return doc.RootElement.Clone();
    }
}
