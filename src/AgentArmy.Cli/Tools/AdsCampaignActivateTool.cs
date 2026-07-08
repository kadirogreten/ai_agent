using System.Text.Json;

namespace AgentArmy.Cli;

// PR-S4: kampanya aktivasyonu (demo) — R3, cap guardrail gate öncesi, compensation = pause.

public sealed class AdsCampaignActivateTool : ITool, IToolPreGate, ICompensable
{
    public string Slug => "ads_campaign_activate";

    private static readonly JsonElement InputSchemaJson = Schema("""
    {
      "type": "object",
      "required": ["campaign_id"],
      "properties": {
        "campaign_id": { "type": "string" }
      }
    }
    """);

    private static readonly JsonElement OutputSchemaJson = Schema("""
    {
      "type": "object",
      "properties": {
        "campaign_id": { "type": "string" },
        "status":      { "type": "string" },
        "activated_at": { "type": "string" }
      }
    }
    """);

    public ToolDescriptor Descriptor => new()
    {
        Slug         = Slug,
        Name         = "Reklam Kampanyası Aktive Et",
        Description  = "Onaylı kampanyayı aktive eder; harcama başlar (demo). R3 — cap kontrolü araç içinde.",
        Category     = "communication",
        SideEffect   = ToolSideEffect.Write,
        Reversible   = true,
        MinRisk      = "R3",
        Compensation = "ads_campaign_pause",
        InputSchema  = InputSchemaJson,
        OutputSchema = OutputSchemaJson,
    };

    public async Task<ToolResult?> ValidateBeforeGateAsync(JsonElement args, RunContext ctx, CancellationToken ct)
    {
        if (!TryCampaignId(args, out var campaignId))
            return ToolResult.Failure(Slug, "Zorunlu 'campaign_id' eksik.");

        var owner = ctx.OwnerId;
        if (string.IsNullOrWhiteSpace(owner))
            return ToolResult.Failure(Slug, "RUN_OWNER_USER_ID yok — cap kontrolü yapılamıyor.");

        if (ctx.Db is null)
            return ToolResult.Failure(Slug, "DB yapılandırılmamış — ledger okunamıyor.");

        var ledger = await AdsLedgerHelper.TryLoadAsync(ctx.Db, owner, campaignId, ct);
        if (ledger is null)
            return ToolResult.Failure(Slug, $"Kampanya bulunamadı: {campaignId}");

        var (maxDaily, maxTotal) = await AdsBudgetGuard.LoadPolicyCapsAsync(ctx.Db, owner, ct);
        if (AdsBudgetGuard.ExceedsCap(ledger.DailyBudget, ledger.TotalBudgetCap, maxDaily, maxTotal))
            return ToolResult.Failure(Slug, AdsBudgetGuard.CapExceededMessage(
                ledger.DailyBudget, ledger.TotalBudgetCap, maxDaily, maxTotal));

        return null;
    }

    public async Task<ToolResult> InvokeAsync(JsonElement args, RunContext ctx, CancellationToken ct)
    {
        if (!TryCampaignId(args, out var campaignId))
            return ToolResult.Failure(Slug, "Zorunlu 'campaign_id' eksik.");

        var owner = ctx.OwnerId;
        if (string.IsNullOrWhiteSpace(owner))
            return ToolResult.Failure(Slug, "RUN_OWNER_USER_ID yok — aktivasyon yapılamıyor.");

        if (ctx.Db is null)
            return ToolResult.Failure(Slug, "DB yapılandırılmamış — ledger güncellenemiyor.");

        var ledger = await AdsLedgerHelper.TryLoadAsync(ctx.Db, owner, campaignId, ct);
        if (ledger is null)
            return ToolResult.Failure(Slug, $"Kampanya bulunamadı: {campaignId}");

        if (ledger.Status != "paused")
            return ToolResult.Failure(Slug, $"Kampanya '{campaignId}' paused değil (mevcut: {ledger.Status}).");

        try
        {
            await AdsLedgerHelper.TryUpdateStatusAsync(ctx.Db, owner, campaignId, "active", ct);
        }
        catch (Exception ex)
        {
            return ToolResult.Failure(Slug, $"Aktivasyon başarısız: {ex.Message}");
        }

        var output = JsonSerializer.SerializeToElement(new
        {
            campaign_id  = campaignId,
            status       = "active",
            activated_at = "2026-07-08T12:00:00Z",
        });

        var token = JsonSerializer.Serialize(new { campaign_id = campaignId });
        return ToolResult.Success(Slug, output, compensationToken: token);
    }

    public async Task<CompensationResult> CompensateAsync(string token, SupabaseWriter? db, string? ownerId, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(token))
            return CompensationResult.Failure("Boş compensation_token.");

        string? campaignId = null;
        try
        {
            using var doc = JsonDocument.Parse(token);
            campaignId = doc.RootElement.TryGetProperty("campaign_id", out var c) ? c.GetString() : null;
        }
        catch (Exception ex)
        {
            return CompensationResult.Failure($"Token ayrıştırılamadı: {ex.Message}");
        }

        if (string.IsNullOrWhiteSpace(campaignId))
            return CompensationResult.Failure("Token'da campaign_id yok.");

        if (db is not null && !string.IsNullOrWhiteSpace(ownerId))
        {
            try
            {
                await AdsLedgerHelper.TryUpdateStatusAsync(db, ownerId, campaignId, "paused", ct);
            }
            catch (Exception ex)
            {
                return CompensationResult.Failure($"Pause başarısız: {ex.Message}");
            }
        }

        Console.Error.WriteLine($"[ads_campaign_activate] ads_campaign_pause campaignId={campaignId}");
        return CompensationResult.Success($"Kampanya duraklatıldı: {campaignId}");
    }

    private static bool TryCampaignId(JsonElement args, out string campaignId)
    {
        campaignId = string.Empty;
        if (args.ValueKind != JsonValueKind.Object) return false;
        if (!args.TryGetProperty("campaign_id", out var el) || el.ValueKind != JsonValueKind.String)
            return false;
        campaignId = el.GetString()!.Trim();
        return campaignId.Length > 0;
    }

    private static JsonElement Schema(string json)
    {
        using var doc = JsonDocument.Parse(json);
        return doc.RootElement.Clone();
    }
}
