using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;

namespace AgentArmy.Cli;

public sealed class OpenAiResponsesClient : ILlmClient
{
    private readonly HttpClient _http;
    private readonly string _model;
    private readonly bool _enableWebSearch;
    private readonly IReadOnlyList<string>? _allowedDomains;

    public OpenAiResponsesClient(HttpClient http, string apiKey, string model, bool enableWebSearch, IReadOnlyList<string>? allowedDomains = null)
    {
        _http = http;
        _model = model;
        _enableWebSearch = enableWebSearch;
        _allowedDomains = allowedDomains;
        _http.BaseAddress = new Uri("https://api.openai.com/v1/");
        _http.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", apiKey);
    }

    public async Task<string> CompleteAsync(string systemPrompt, string userPrompt, CancellationToken cancellationToken)
    {
        var input = new object[]
        {
            new
            {
                role = "system",
                content = new object[] { new { type = "input_text", text = systemPrompt } }
            },
            new
            {
                role = "user",
                content = new object[] { new { type = "input_text", text = userPrompt } }
            }
        };

        if (!_enableWebSearch)
        {
            var payload = new
            {
                model = _model,
                input,
                temperature = 0.2
            };

            var respText = await PostAsync(payload, cancellationToken);
            return ExtractTextWithSources(respText);
        }

        var toolWithFilters = _allowedDomains is { Count: > 0 }
            ? new
            {
                type = "web_search",
                filters = new
                {
                    allowed_domains = _allowedDomains
                }
            }
            : null;

        if (toolWithFilters is not null)
        {
            var payloadWithFilters = new
            {
                model = _model,
                tools = new object[] { toolWithFilters },
                input,
                temperature = 0.2
            };

            try
            {
                var respText = await PostAsync(payloadWithFilters, cancellationToken);
                return ExtractTextWithSources(respText);
            }
            catch (InvalidOperationException ex) when (ex.Message.Contains("Parameter 'filters' not supported", StringComparison.OrdinalIgnoreCase))
            {
            }
        }

        var payloadNoFilters = new
        {
            model = _model,
            tools = new object[] { new { type = "web_search" } },
            input,
            temperature = 0.2
        };

        var respTextNoFilters = await PostAsync(payloadNoFilters, cancellationToken);
        return ExtractTextWithSources(respTextNoFilters);
    }

    private async Task<string> PostAsync(object payload, CancellationToken cancellationToken)
    {
        var json = JsonSerializer.Serialize(payload);
        using var content = new StringContent(json, Encoding.UTF8, "application/json");
        using var resp = await _http.PostAsync("responses", content, cancellationToken);
        var respText = await resp.Content.ReadAsStringAsync(cancellationToken);
        if (!resp.IsSuccessStatusCode)
        {
            throw new InvalidOperationException($"OpenAI request failed: {(int)resp.StatusCode} {resp.ReasonPhrase}\n{respText}");
        }
        return respText;
    }

    private static string ExtractTextWithSources(string respText)
    {
        using var doc = JsonDocument.Parse(respText);
        var root = doc.RootElement;

        var text = TryGetOutputText(root) ?? TryGetMessageText(root) ?? string.Empty;
        var sources = CollectSources(root);

        if (sources.Count == 0)
        {
            return text.Trim();
        }

        var sb = new StringBuilder();
        sb.AppendLine(text.Trim());
        sb.AppendLine();
        sb.AppendLine("## Kaynaklar");
        sb.AppendLine();
        foreach (var s in sources)
        {
            if (!string.IsNullOrWhiteSpace(s.Title))
            {
                sb.AppendLine($"- [{EscapeMd(s.Title)}]({s.Url})");
            }
            else
            {
                sb.AppendLine($"- {s.Url}");
            }
        }

        return sb.ToString().Trim();
    }

    private static string? TryGetOutputText(JsonElement root)
    {
        if (root.TryGetProperty("output_text", out var outputText) && outputText.ValueKind == JsonValueKind.String)
        {
            return outputText.GetString();
        }
        return null;
    }

    private static string? TryGetMessageText(JsonElement root)
    {
        if (!root.TryGetProperty("output", out var output) || output.ValueKind != JsonValueKind.Array) return null;

        var sb = new StringBuilder();
        foreach (var item in output.EnumerateArray())
        {
            if (!item.TryGetProperty("type", out var typeEl) || typeEl.ValueKind != JsonValueKind.String) continue;
            if (!string.Equals(typeEl.GetString(), "message", StringComparison.OrdinalIgnoreCase)) continue;

            if (!item.TryGetProperty("content", out var contentEl) || contentEl.ValueKind != JsonValueKind.Array) continue;
            foreach (var c in contentEl.EnumerateArray())
            {
                if (!c.TryGetProperty("type", out var ct) || ct.ValueKind != JsonValueKind.String) continue;
                if (!string.Equals(ct.GetString(), "output_text", StringComparison.OrdinalIgnoreCase)) continue;
                if (c.TryGetProperty("text", out var textEl) && textEl.ValueKind == JsonValueKind.String)
                {
                    sb.AppendLine(textEl.GetString());
                }
            }
        }

        var text = sb.ToString().Trim();
        return string.IsNullOrWhiteSpace(text) ? null : text;
    }

    private sealed record Source(string Url, string? Title);

    private static List<Source> CollectSources(JsonElement root)
    {
        var dict = new Dictionary<string, Source>(StringComparer.OrdinalIgnoreCase);

        if (root.TryGetProperty("sources", out var sources) && sources.ValueKind == JsonValueKind.Array)
        {
            foreach (var s in sources.EnumerateArray())
            {
                if (s.ValueKind != JsonValueKind.Object) continue;
                if (!s.TryGetProperty("url", out var urlEl) || urlEl.ValueKind != JsonValueKind.String) continue;
                var url = urlEl.GetString();
                if (string.IsNullOrWhiteSpace(url)) continue;
                var title = s.TryGetProperty("title", out var titleEl) && titleEl.ValueKind == JsonValueKind.String
                    ? titleEl.GetString()
                    : null;
                dict[url] = new Source(url, title);
            }
        }

        if (root.TryGetProperty("output", out var output) && output.ValueKind == JsonValueKind.Array)
        {
            foreach (var item in output.EnumerateArray())
            {
                if (!item.TryGetProperty("type", out var typeEl) || typeEl.ValueKind != JsonValueKind.String) continue;
                if (!string.Equals(typeEl.GetString(), "message", StringComparison.OrdinalIgnoreCase)) continue;
                if (!item.TryGetProperty("content", out var contentEl) || contentEl.ValueKind != JsonValueKind.Array) continue;
                foreach (var c in contentEl.EnumerateArray())
                {
                    if (!c.TryGetProperty("annotations", out var ann) || ann.ValueKind != JsonValueKind.Array) continue;
                    foreach (var a in ann.EnumerateArray())
                    {
                        if (a.ValueKind != JsonValueKind.Object) continue;
                        if (!a.TryGetProperty("type", out var at) || at.ValueKind != JsonValueKind.String) continue;
                        if (!string.Equals(at.GetString(), "url_citation", StringComparison.OrdinalIgnoreCase)) continue;
                        if (!a.TryGetProperty("url", out var urlEl) || urlEl.ValueKind != JsonValueKind.String) continue;
                        var url = urlEl.GetString();
                        if (string.IsNullOrWhiteSpace(url)) continue;
                        var title = a.TryGetProperty("title", out var titleEl) && titleEl.ValueKind == JsonValueKind.String
                            ? titleEl.GetString()
                            : null;
                        if (!dict.ContainsKey(url)) dict[url] = new Source(url, title);
                    }
                }
            }
        }

        return dict.Values.OrderBy(s => s.Url).ToList();
    }

    private static string EscapeMd(string s)
    {
        return s.Replace("[", "\\[").Replace("]", "\\]");
    }
}
