using System.Text.Json;

namespace AgentArmy.Cli;

// Faz A — Tool Invocation: file_store (geri-alınabilir yazma aracı, PR6).
// Tasarım: docs/faz-a-tool-invocation-tasarim.md (§4)
// Verilen içeriği çalıştırma klasörüne (RunDir/files) bir dosya olarak yazar ve yolunu döner.
// Yan etkili ama GERİ-ALINABİLİR: compensation_token = silinecek dosya yolu (delete_object).
// Min risk R1 → RiskGate'te R0/R1 oto-onaydan geçer (yüksek riskli görevlerde onaya tabi).
// Not: Faz A'da yerel dosya sistemine yazar; S3/Supabase Storage arka ucu sonraki adım.

public sealed class FileStoreTool : ITool
{
    public string Slug => "file_store";

    private static readonly JsonElement InputSchemaJson = Schema("""
    {
      "type": "object",
      "required": ["name", "content"],
      "properties": {
        "name": { "type": "string", "description": "Dosya adı (örn. ozet.md)" },
        "content": { "type": "string", "description": "Yazılacak metin içeriği" }
      }
    }
    """);

    public ToolDescriptor Descriptor => new()
    {
        Slug         = Slug,
        Name         = "Dosya Depolama",
        Description  = "Verilen içeriği çalıştırma klasörüne dosya olarak yazar; yolunu döner. Geri-alınabilir (dosya silinir).",
        Category     = "storage",
        SideEffect   = ToolSideEffect.Write,
        Reversible   = true,
        MinRisk      = "R1",
        Compensation = "delete_object",
        InputSchema  = InputSchemaJson,
    };

    public async Task<ToolResult> InvokeAsync(JsonElement args, RunContext ctx, CancellationToken ct)
    {
        if (args.ValueKind != JsonValueKind.Object
            || !args.TryGetProperty("name", out var nameEl) || nameEl.ValueKind != JsonValueKind.String
            || !args.TryGetProperty("content", out var contentEl) || contentEl.ValueKind != JsonValueKind.String)
        {
            return ToolResult.Failure(Slug, "Zorunlu 'name' ve 'content' (string) argümanları eksik.");
        }

        if (string.IsNullOrWhiteSpace(ctx.RunDir))
            return ToolResult.Failure(Slug, "Çalıştırma klasörü (RunDir) yok; dosya yazılamıyor.");

        var safeName = SafeName(nameEl.GetString() ?? "dosya.txt");
        var dir      = Path.Combine(ctx.RunDir, "files");
        var path     = Path.Combine(dir, safeName);

        try
        {
            Directory.CreateDirectory(dir);
            await File.WriteAllTextAsync(path, contentEl.GetString() ?? string.Empty, ct);
        }
        catch (OperationCanceledException)
        {
            throw;
        }
        catch (Exception ex)
        {
            return ToolResult.Failure(Slug, $"Yazma hatası: {ex.Message}");
        }

        long bytes;
        try { bytes = new FileInfo(path).Length; } catch { bytes = 0; }

        var output = JsonSerializer.SerializeToElement(new { path, name = safeName, bytes });
        // Geri-alma anahtarı: silinecek dosya yolu.
        return ToolResult.Success(Slug, output, compensationToken: path);
    }

    private static string SafeName(string input)
    {
        var name = Path.GetFileName((input ?? string.Empty).Trim().Replace("\\", "/"));
        return string.IsNullOrWhiteSpace(name) ? "dosya.txt" : name;
    }

    private static JsonElement Schema(string json)
    {
        using var doc = JsonDocument.Parse(json);
        return doc.RootElement.Clone();
    }
}
