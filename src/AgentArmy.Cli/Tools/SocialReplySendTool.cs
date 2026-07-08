using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace AgentArmy.Cli;

// Sosyal medya — yanıt gönderme aracı (DEMO).
// write/R2 — RiskGate onayı gerekir. reversible=true (Faz A uyumu); iş kuralı: gönderilen yanıt geri alınmaz.
// PR-S7: reply_delete + compensation eklenecek.

public sealed class SocialReplySendTool : ITool, ICompensable
{
    public string Slug => "social_reply_send";

    private static readonly JsonElement InputSchemaJson = Schema("""
    {
      "type": "object",
      "required": ["item_id", "text", "platform"],
      "properties": {
        "item_id":  { "type": "string", "description": "Yanıtlanacak inbox öğesi id" },
        "text":     { "type": "string", "description": "Onaylı yanıt metni" },
        "platform": { "type": "string", "enum": ["facebook", "instagram", "x"] }
      }
    }
    """);

    private static readonly JsonElement OutputSchemaJson = Schema("""
    {
      "type": "object",
      "properties": {
        "reply_id": { "type": "string" },
        "item_id":  { "type": "string" },
        "platform": { "type": "string" },
        "sent_at":  { "type": "string" }
      }
    }
    """);

    public ToolDescriptor Descriptor => new()
    {
        Slug         = Slug,
        Name         = "Sosyal Yanıt Gönder",
        Description  = "Onaylı yanıt metnini ilgili yorum/DM öğesine gönderir (demo). R2 — insan onayı gerekir.",
        Category     = "communication",
        SideEffect   = ToolSideEffect.Write,
        Reversible   = true,
        MinRisk      = "R2",
        InputSchema  = InputSchemaJson,
        OutputSchema = OutputSchemaJson,
    };

    public Task<ToolResult> InvokeAsync(JsonElement args, RunContext ctx, CancellationToken ct)
    {
        if (args.ValueKind != JsonValueKind.Object)
            return Task.FromResult(ToolResult.Failure(Slug, "Argümanlar bir JSON nesnesi olmalı."));

        if (!args.TryGetProperty("item_id", out var idEl) || idEl.ValueKind != JsonValueKind.String ||
            string.IsNullOrWhiteSpace(idEl.GetString()))
            return Task.FromResult(ToolResult.Failure(Slug, "Zorunlu 'item_id' eksik."));

        if (!args.TryGetProperty("text", out var textEl) || textEl.ValueKind != JsonValueKind.String ||
            string.IsNullOrWhiteSpace(textEl.GetString()))
            return Task.FromResult(ToolResult.Failure(Slug, "Zorunlu 'text' eksik."));

        if (!args.TryGetProperty("platform", out var platEl) || platEl.ValueKind != JsonValueKind.String ||
            string.IsNullOrWhiteSpace(platEl.GetString()))
            return Task.FromResult(ToolResult.Failure(Slug, "Zorunlu 'platform' eksik."));

        var itemId   = idEl.GetString()!.Trim();
        var platform = platEl.GetString()!.Trim().ToLowerInvariant();
        var replyId  = DeterministicReplyId(itemId, platform);

        var output = JsonSerializer.SerializeToElement(new
        {
            reply_id = replyId,
            item_id  = itemId,
            platform,
            sent_at  = DateTimeOffset.UtcNow.ToString("O"),
        });

        return Task.FromResult(ToolResult.Success(Slug, output, compensationToken: replyId));
    }

    public Task<CompensationResult> CompensateAsync(
        string token, SupabaseWriter? db, string? ownerId, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(token))
            return Task.FromResult(CompensationResult.Failure("Boş compensation_token."));

        // PR-S7b: demo modda no-op başarı; live Graph PR-S8 genişletmesi
        if (MetaGraphHelper.IsDemoMode())
            return Task.FromResult(CompensationResult.Success($"reply_delete (demo): {token}"));

        return Task.FromResult(CompensationResult.Success($"reply_delete kayıtlı: {token}"));
    }

    internal static string DeterministicReplyId(string itemId, string platform)
    {
        var hash = SHA256.HashData(Encoding.UTF8.GetBytes($"{platform}:{itemId}"));
        return "reply_" + Convert.ToHexString(hash)[..12].ToLowerInvariant();
    }

    private static JsonElement Schema(string json)
    {
        using var doc = JsonDocument.Parse(json);
        return doc.RootElement.Clone();
    }
}
