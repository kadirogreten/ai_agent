using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace AgentArmy.Cli;

public sealed class FactsExtractor
{
    private readonly ILlmClient _llm;

    public FactsExtractor(ILlmClient llm)
    {
        _llm = llm;
    }

    public async Task<IReadOnlyList<FactEntry>> ExtractAsync(string topic, string runId, string playbookId, string markdown, CancellationToken ct)
    {
        var system = "Sen bir bilgi çıkarımı uzmanısın. Verilen Markdown metinden doğrulanabilir fakt iddiaları çıkaracaksın.";

        var user = BuildPrompt(topic, markdown);
        var jsonText = await _llm.CompleteAsync(system, user, ct);

        var entries = ParseFacts(jsonText, topic, runId, playbookId);
        var now = DateTimeOffset.UtcNow;
        return entries
            .Select(e => e with { ExtractedAtUtc = now })
            .ToArray();
    }

    private static string BuildPrompt(string topic, string markdown)
    {
        var sb = new StringBuilder();
        sb.AppendLine("Konu: " + topic);
        sb.AppendLine();
        sb.AppendLine("Aşağıdaki Markdown içeriğinden fakt iddiaları çıkar.");
        sb.AppendLine();
        sb.AppendLine("Kurallar:");
        sb.AppendLine("- SADECE JSON döndür. Markdown, açıklama, kod bloğu yok.");
        sb.AppendLine("- Çıktı bir JSON array olmalı.");
        sb.AppendLine("- Her öğe şu alanlara sahip olmalı: claim, evidenceUrl, evidenceQuote, sourceTitle, confidence.");
        sb.AppendLine("- evidenceUrl zorunlu ve gerçek bir URL olmalı; yoksa o iddiayı çıkarma.");
        sb.AppendLine("- evidenceQuote, URL’deki kanıtı temsil eden kısa bir alıntı/kanıt cümlesi olmalı. Bilinmiyorsa boş string verme; o iddiayı çıkarma.");
        sb.AppendLine("- confidence 0 ile 1 arasında sayı olmalı.");
        sb.AppendLine("- En fazla 30 fakt çıkar.");
        sb.AppendLine();
        sb.AppendLine("Markdown:");
        sb.AppendLine(markdown);
        return sb.ToString();
    }

    private static IReadOnlyList<FactEntry> ParseFacts(string jsonText, string topic, string runId, string playbookId)
    {
        var trimmed = jsonText.Trim();
        using var doc = JsonDocument.Parse(trimmed);
        if (doc.RootElement.ValueKind != JsonValueKind.Array)
        {
            throw new InvalidOperationException("Facts extraction did not return a JSON array.");
        }

        var list = new List<FactEntry>();
        foreach (var el in doc.RootElement.EnumerateArray())
        {
            if (el.ValueKind != JsonValueKind.Object) continue;

            var claim = el.TryGetProperty("claim", out var c) && c.ValueKind == JsonValueKind.String ? c.GetString() : null;
            var evidenceUrl = el.TryGetProperty("evidenceUrl", out var u) && u.ValueKind == JsonValueKind.String ? u.GetString() : null;
            var evidenceQuote = el.TryGetProperty("evidenceQuote", out var q) && q.ValueKind == JsonValueKind.String ? q.GetString() : null;
            var sourceTitle = el.TryGetProperty("sourceTitle", out var t) && t.ValueKind == JsonValueKind.String ? t.GetString() : null;
            var confidence = el.TryGetProperty("confidence", out var conf) && conf.ValueKind == JsonValueKind.Number ? conf.GetDouble() : (double?)null;

            if (string.IsNullOrWhiteSpace(claim)) continue;
            if (string.IsNullOrWhiteSpace(evidenceUrl)) continue;
            if (string.IsNullOrWhiteSpace(evidenceQuote)) continue;
            if (confidence is null) continue;
            var confValue = Math.Clamp(confidence.Value, 0, 1);

            var domain = TryGetDomain(evidenceUrl);
            var id = ComputeId(claim, evidenceUrl);
            list.Add(new FactEntry(
                Id: id,
                Topic: topic,
                Claim: claim.Trim(),
                EvidenceUrl: evidenceUrl.Trim(),
                EvidenceQuote: evidenceQuote.Trim(),
                SourceTitle: string.IsNullOrWhiteSpace(sourceTitle) ? null : sourceTitle.Trim(),
                SourceDomain: domain,
                Confidence: confValue,
                RunId: runId,
                PlaybookId: playbookId,
                ExtractedAtUtc: DateTimeOffset.UtcNow
            ));
        }

        return list;
    }

    private static string TryGetDomain(string url)
    {
        try
        {
            var uri = new Uri(url);
            return uri.Host;
        }
        catch
        {
            return string.Empty;
        }
    }

    private static string ComputeId(string claim, string evidenceUrl)
    {
        var bytes = Encoding.UTF8.GetBytes(claim.Trim() + "\n" + evidenceUrl.Trim());
        return Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant();
    }
}

