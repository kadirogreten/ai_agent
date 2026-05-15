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

    public async Task<LlmResult> CompleteAsync(string systemPrompt, string userPrompt, CancellationToken cancellationToken)
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
            var payload = BuildPayload(input, tools: null, includeTemperature: true);
            var respText = await PostWithFallbackAsync(payload, cancellationToken);
            return ExtractResult(respText);
        }

        Dictionary<string, object?>? payloadWithFilters = null;
        if (_allowedDomains is { Count: > 0 })
        {
            var toolWithFilters = new Dictionary<string, object?>
            {
                ["type"] = "web_search",
                ["filters"] = new Dictionary<string, object?>
                {
                    ["allowed_domains"] = _allowedDomains
                }
            };
            payloadWithFilters = BuildPayload(input, tools: new object[] { toolWithFilters }, includeTemperature: true);
        }

        if (payloadWithFilters is not null)
        {
            try
            {
                var respText = await PostWithFallbackAsync(payloadWithFilters, cancellationToken);
                return ExtractResult(respText);
            }
            catch (InvalidOperationException ex) when (ex.Message.Contains("Parameter 'filters' not supported", StringComparison.OrdinalIgnoreCase))
            {
            }
        }

        var payloadNoFilters = BuildPayload(input, tools: new object[] { new Dictionary<string, object?> { ["type"] = "web_search" } }, includeTemperature: true);
        var respTextNoFilters = await PostWithFallbackAsync(payloadNoFilters, cancellationToken);
        return ExtractResult(respTextNoFilters);
    }

    private Dictionary<string, object?> BuildPayload(object input, object[]? tools, bool includeTemperature)
    {
        var payload = new Dictionary<string, object?>
        {
            ["model"] = _model,
            ["input"] = input
        };

        if (tools is not null)
        {
            payload["tools"] = tools;
        }

        if (includeTemperature)
        {
            payload["temperature"] = 0.2;
        }

        return payload;
    }

    private async Task<string> PostWithFallbackAsync(Dictionary<string, object?> payload, CancellationToken cancellationToken)
    {
        try
        {
            return await PostAsync(payload, cancellationToken);
        }
        catch (InvalidOperationException ex) when (ex.Message.Contains("Unsupported parameter: 'temperature'", StringComparison.OrdinalIgnoreCase))
        {
            var copy = new Dictionary<string, object?>(payload);
            copy.Remove("temperature");
            return await PostAsync(copy, cancellationToken);
        }
    }

    private async Task<string> PostAsync(Dictionary<string, object?> payload, CancellationToken cancellationToken)
    {
        var json = JsonSerializer.Serialize(payload);
        // HttpRetry her denemede yeni HttpRequestMessage üretir (content'i tekrar kullanabiliriz).
        using var resp = await HttpRetry.SendAsync(_http, () =>
        {
            var req = new HttpRequestMessage(HttpMethod.Post, "responses")
            {
                Content = new StringContent(json, Encoding.UTF8, "application/json")
            };
            return req;
        }, cancellationToken);

        var respText = await resp.Content.ReadAsStringAsync(cancellationToken);
        if (!resp.IsSuccessStatusCode)
        {
            throw new InvalidOperationException($"OpenAI request failed: {(int)resp.StatusCode} {resp.ReasonPhrase}\n{respText}");
        }
        return respText;
    }

    private LlmResult ExtractResult(string respText)
    {
        using var doc = JsonDocument.Parse(respText);
        var root = doc.RootElement;

        var text = TryGetOutputText(root) ?? TryGetMessageText(root) ?? string.Empty;
        var sources = CollectSources(root);

        if (sources.Count > 0)
        {
            var sb = new StringBuilder();
            sb.AppendLine(text.Trim());
            sb.AppendLine();
            sb.AppendLine("## Kaynaklar");
            sb.AppendLine();
            foreach (var s in sources)
            {
                if (!string.IsNullOrWhiteSpace(s.Title))
                    sb.AppendLine($"- [{EscapeMd(s.Title)}]({s.Url})");
                else
                    sb.AppendLine($"- {s.Url}");
            }
            text = sb.ToString();
        }

        var (tokensIn, tokensOut) = ExtractUsage(root);
        return new LlmResult(text.Trim(), _model, tokensIn, tokensOut);
    }

    private static (int TokensIn, int TokensOut) ExtractUsage(JsonElement root)
    {
        // OpenAI Responses API: root.usage.input_tokens / output_tokens
        if (!root.TryGetProperty("usage", out var usage) || usage.ValueKind != JsonValueKind.Object)
            return (0, 0);

        int Get(string name)
        {
            if (usage.TryGetProperty(name, out var el) && el.ValueKind == JsonValueKind.Number)
                return el.TryGetInt32(out var v) ? v : 0;
            return 0;
        }

        return (Get("input_tokens"), Get("output_tokens"));
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
