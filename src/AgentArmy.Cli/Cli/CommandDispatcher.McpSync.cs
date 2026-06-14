using System.Text.Json;

namespace AgentArmy.Cli;

// mcp-sync: MCP sunucusundan tools/list çekip tools tablosuna taslak satırlar ekler.
//
// Kullanım: dotnet run -- mcp-sync --server <slug> [--dry-run]
//
// Davranış:
//   1. mcp_servers tablosundan <slug>'u bul.
//   2. tools/list çek (McpClient.ListToolsAsync).
//   3. Her araç için:
//      - slug = {server_slug}__{tool_name} (çift alt çizgi, global UNIQUE uyumlu)
//      - tools tablosunda yoksa INSERT (enabled=false, sözleşme en kısıtlayıcı varsayılan).
//      - Zaten varsa atla (idempotent).
//   4. Özet yaz.
//
// Sözleşme varsayılanları (insan portal'dan değiştirene kadar):
//   category='utility', side_effect='external', reversible=false, min_risk='R3'
//   → IsAllowedInPhaseA = false → Faz A kuralı gereği çalıştırılamaz.
//
// tenant_id: platform sunucu (owner_user_id IS NULL) → NULL; owner sunucu → owner UUID.

public static partial class CommandDispatcher
{
    private static async Task<int> McpSyncAsync(string rootDir, string[] args, CancellationToken ct)
    {
        // ── Argüman parse ────────────────────────────────────────────────────
        string? serverSlug = null;
        var dryRun = false;

        for (var i = 0; i < args.Length; i++)
        {
            if ((args[i] == "--server" || args[i] == "-s") && i + 1 < args.Length)
                serverSlug = args[++i];
            else if (args[i] == "--dry-run")
                dryRun = true;
        }

        if (string.IsNullOrWhiteSpace(serverSlug))
        {
            Console.Error.WriteLine("Kullanım: mcp-sync --server <slug> [--dry-run]");
            return 1;
        }

        // ── DB bağlantısı ─────────────────────────────────────────────────────
        var supabase = GetSupabase(rootDir);
        using var db = SupabaseWriter.TryCreate(supabase);
        if (db is null)
        {
            Console.Error.WriteLine("[mcp-sync] DB bağlantısı kurulamadı (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY eksik).");
            return 1;
        }

        // ── Sunucu kaydını bul ────────────────────────────────────────────────
        var serverJson = await db.SelectAsync(
            "mcp_servers",
            $"slug=eq.{Uri.EscapeDataString(serverSlug)}&select=id,owner_user_id,endpoint,auth_env,transport,enabled&limit=1",
            ct);

        if (serverJson.ValueKind != JsonValueKind.Array || serverJson.GetArrayLength() == 0)
        {
            Console.Error.WriteLine($"[mcp-sync] '{serverSlug}' sunucusu mcp_servers tablosunda bulunamadı.");
            return 1;
        }

        var srv = serverJson[0];
        var serverId    = srv.TryGetProperty("id",             out var idEl)   && idEl.ValueKind == JsonValueKind.String ? idEl.GetString()! : "";
        var ownerUserId = srv.TryGetProperty("owner_user_id",  out var ouEl)   && ouEl.ValueKind == JsonValueKind.String ? ouEl.GetString()  : null;
        var endpoint    = srv.TryGetProperty("endpoint",       out var epEl)   && epEl.ValueKind == JsonValueKind.String ? epEl.GetString()! : "";
        var authEnv     = srv.TryGetProperty("auth_env",       out var aeEl)   && aeEl.ValueKind == JsonValueKind.String ? aeEl.GetString()  : null;
        var transport   = srv.TryGetProperty("transport",      out var trEl)   && trEl.ValueKind == JsonValueKind.String ? trEl.GetString()  : "http";
        var serverEnabled = !srv.TryGetProperty("enabled",     out var enEl)   || enEl.ValueKind != JsonValueKind.False;

        if (!serverEnabled)
            Console.Error.WriteLine($"[mcp-sync] Uyarı: '{serverSlug}' sunucusu devre dışı (enabled=false). Yine de devam ediliyor.");

        if (transport != "http")
        {
            Console.Error.WriteLine($"[mcp-sync] transport='{transport}' bu PR'da desteklenmiyor (yalnız 'http'). stdio sonraki PR'a bırakıldı.");
            return 1;
        }

        Console.WriteLine($"[mcp-sync] Sunucu: {serverSlug} ({endpoint}){(dryRun ? " [DRY-RUN]" : "")}");

        // ── MCP tools/list ────────────────────────────────────────────────────
        var timeoutSec = await PolicyReader.GetAsync(db, null, "mcp.call_timeout_seconds", 60, ct);
        using var client = new McpClient(endpoint, authEnv, timeoutSec);

        IReadOnlyList<McpToolDef> mcpTools;
        try
        {
            mcpTools = await client.ListToolsAsync(ct);
        }
        catch (McpException ex)
        {
            Console.Error.WriteLine($"[mcp-sync] tools/list başarısız: {ex.Message}");
            return 1;
        }

        Console.WriteLine($"[mcp-sync] {mcpTools.Count} araç alındı.");

        // ── Mevcut slugları yükle (idempotency) ───────────────────────────────
        var existingJson = await db.SelectAsync(
            "tools",
            $"mcp_server_id=eq.{Uri.EscapeDataString(serverId)}&select=slug",
            ct);

        var existingSlugs = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        if (existingJson.ValueKind == JsonValueKind.Array)
            foreach (var r in existingJson.EnumerateArray())
                if (r.TryGetProperty("slug", out var sEl) && sEl.ValueKind == JsonValueKind.String)
                    existingSlugs.Add(sEl.GetString()!);

        // ── Taslak satırlar ekle ─────────────────────────────────────────────
        int added = 0, skipped = 0;
        foreach (var tool in mcpTools)
        {
            // slug format: {server_slug}__{tool_name} (çift alt çizgi).
            // Slug'lar lowercase+tire+alt çizgi normalize: boşluk → alt çizgi, özel char kaldır.
            var normalName = tool.Name.ToLowerInvariant()
                .Replace(' ', '_')
                .Replace('-', '_');
            var toolSlug = $"{serverSlug}__{normalName}";

            if (existingSlugs.Contains(toolSlug))
            {
                Console.WriteLine($"  SKIP {toolSlug} (zaten mevcut)");
                skipped++;
                continue;
            }

            Console.WriteLine($"  {(dryRun ? "DRY-RUN " : "")}ADD  {toolSlug} ← {tool.Name}");

            if (!dryRun)
            {
                try
                {
                    // tools.category CHECK: 'utility' tek genel seçenek — 'mcp'/'external' CHECK'te yok.
                    // tools.side_effect, reversible, min_risk: en kısıtlayıcı varsayılan → Faz A reddeder.
                    // İnsan portal'dan sözleşmeyi doldurur + enable eder.
                    await db.InsertAsync("tools", new
                    {
                        slug          = toolSlug,
                        name          = tool.Name,
                        description   = tool.Description.Length > 0 ? tool.Description : (object?)null,
                        category      = "utility",
                        auth_type     = "none",
                        config_schema = new { },
                        input_schema  = tool.InputSchema,
                        output_schema = new { type = "object" },
                        side_effect   = "external",
                        reversible    = false,
                        min_risk      = "R3",
                        enabled       = false,       // insan aktif etene kadar kapalı
                        tenant_id     = ownerUserId, // platform sunucu → NULL; owner → UUID
                        mcp_server_id = serverId,
                        mcp_tool_name = tool.Name,
                    }, ct);
                    added++;
                }
                catch (Exception ex)
                {
                    Console.Error.WriteLine($"  HATA {toolSlug}: {ex.Message}");
                }
            }
            else
            {
                added++;
            }
        }

        Console.WriteLine($"\n[mcp-sync] Tamamlandı: {added} eklendi, {skipped} atlandı.{(dryRun ? " (DRY-RUN — DB'ye yazılmadı)" : "")}");
        Console.WriteLine("[mcp-sync] Sonraki adım: portal Araçlar sayfasından sözleşme alanlarını doldurun ve aracı etkinleştirin.");
        return 0;
    }
}
