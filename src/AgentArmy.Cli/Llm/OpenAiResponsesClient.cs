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

    public OpenAiResponsesClient(HttpClient http, string apiKey, string model, bool enableWebSearch, IReadOnlyList<string>? allowedDomains = null, string? apiBase = null)
    {
        _http = http;
        _model = model;
        _enableWebSearch = enableWebSearch;
        _allowedDomains = allowedDomains;
        var baseUrl = (apiBase?.TrimEnd('/') ?? "https://api.openai.com") + "/v1/";
        _http.BaseAddress = new Uri(baseUrl);
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

    // ── Faz A — Tool Invocation: araç-farkında tur (PR3) ───────────────────────
    // Tasarım: docs/faz-a-tool-invocation-tasarim.md (§3.3)
    // NOT: Responses API function-calling wire formatı (function_call / function_call_output)
    //      canlı API'ye karşı doğrulanmalıdır; sandbox'ta test edilemedi.

    public async Task<LlmTurn> CompleteWithToolsAsync(
        string systemPrompt,
        string userPrompt,
        IReadOnlyList<ToolDescriptor> tools,
        IReadOnlyList<ToolExchange> priorExchanges,
        CancellationToken cancellationToken)
    {
        // input: system + user + önceki (function_call / function_call_output) çiftleri
        var input = new List<object>
        {
            new { role = "system", content = new object[] { new { type = "input_text", text = systemPrompt } } },
            new { role = "user",   content = new object[] { new { type = "input_text", text = userPrompt } } },
        };

        foreach (var ex in priorExchanges)
        {
            // Modelin önceki araç çağrısı
            input.Add(new Dictionary<string, object?>
            {
                ["type"]      = "function_call",
                ["call_id"]   = ex.Call.CallId,
                ["name"]      = ex.Call.Slug,
                ["arguments"] = ArgsToString(ex.Call.Args),
            });
            // Bizim döndürdüğümüz sonuç
            input.Add(new Dictionary<string, object?>
            {
                ["type"]    = "function_call_output",
                ["call_id"] = ex.Call.CallId,
                ["output"]  = ResultToString(ex.Result),
            });
        }

        var toolDefs = BuildFunctionTools(tools);

        // Deterministik araç çağrısı: araç-yetkili adımın İLK turunda (henüz çağrı yapılmamışken)
        // ve gerçek bir fonksiyon aracı varsa, modeli bir araç çağırmaya ZORLA ("required").
        // Böylece Operator metinle "anlatıp" geçemez. Araç çalıştıktan sonra (priorExchanges dolu)
        // serbest bırakılır ki sonucu yorumlayıp adımı bitirebilsin.
        var hasFunctionTool = tools is { Count: > 0 };
        var toolChoice = hasFunctionTool && priorExchanges.Count == 0 ? "required" : null;

        var payload  = BuildPayload(input.ToArray(), tools: toolDefs, includeTemperature: true, toolChoice: toolChoice);
        var respText = await PostWithFallbackAsync(payload, cancellationToken);
        return ExtractTurn(respText);
    }

    /// <summary>ToolDescriptor listesini Responses API "function" araç tanımlarına çevirir;
    /// web search açıksa onu da ekler. Hiç araç yoksa null döner.</summary>
    private object[]? BuildFunctionTools(IReadOnlyList<ToolDescriptor> tools)
    {
        var list = new List<object>();
        if (tools is not null)
        {
            foreach (var t in tools)
            {
                list.Add(new Dictionary<string, object?>
                {
                    ["type"]        = "function",
                    ["name"]        = t.Slug,
                    ["description"] = string.IsNullOrWhiteSpace(t.Description) ? t.Name : t.Description,
                    ["parameters"]  = SchemaOrEmpty(t.InputSchema),
                });
            }
        }

        if (_enableWebSearch)
            list.Add(new Dictionary<string, object?> { ["type"] = "web_search" });

        return list.Count > 0 ? list.ToArray() : null;
    }

    private static object SchemaOrEmpty(JsonElement schema)
    {
        if (schema.ValueKind == JsonValueKind.Object) return schema;
        return new Dictionary<string, object?>
        {
            ["type"]       = "object",
            ["properties"] = new Dictionary<string, object?>(),
        };
    }

    private static string ArgsToString(JsonElement args)
        => args.ValueKind == JsonValueKind.Undefined ? "{}" : args.GetRawText();

    private static string ResultToString(ToolResult result)
    {
        if (!result.Ok)
            return JsonSerializer.Serialize(new { ok = false, error = result.Error });
        if (result.Output is { ValueKind: not JsonValueKind.Undefined } o)
            return o.GetRawText();
        return JsonSerializer.Serialize(new { ok = true });
    }

    private LlmTurn ExtractTurn(string respText)
    {
        using var doc = JsonDocument.Parse(respText);
        var root = doc.RootElement;

        var (tokensIn, tokensOut) = ExtractUsage(root);

        var calls = CollectFunctionCalls(root);
        if (calls.Count > 0)
            return new LlmTurn(null, calls, _model, tokensIn, tokensOut);

        var text = TryGetOutputText(root) ?? TryGetMessageText(root) ?? string.Empty;
        return new LlmTurn(text.Trim(), Array.Empty<ToolCall>(), _model, tokensIn, tokensOut);
    }

    private static List<ToolCall> CollectFunctionCalls(JsonElement root)
    {
        var calls = new List<ToolCall>();
        if (!root.TryGetProperty("output", out var output) || output.ValueKind != JsonValueKind.Array)
            return calls;

        foreach (var item in output.EnumerateArray())
        {
            if (item.ValueKind != JsonValueKind.Object) continue;
            if (!item.TryGetProperty("type", out var typeEl) || typeEl.ValueKind != JsonValueKind.String) continue;
            if (!string.Equals(typeEl.GetString(), "function_call", StringComparison.OrdinalIgnoreCase)) continue;

            var name = item.TryGetProperty("name", out var nEl) && nEl.ValueKind == JsonValueKind.String
                ? nEl.GetString()
                : null;
            if (string.IsNullOrWhiteSpace(name)) continue;

            string? callId = null;
            if (item.TryGetProperty("call_id", out var cEl) && cEl.ValueKind == JsonValueKind.String)
                callId = cEl.GetString();
            else if (item.TryGetProperty("id", out var idEl) && idEl.ValueKind == JsonValueKind.String)
                callId = idEl.GetString();
            callId ??= Guid.NewGuid().ToString();

            calls.Add(new ToolCall(name!, ParseArguments(item), callId));
        }

        return calls;
    }

    /// <summary>function_call.arguments alanı JSON-string'tir; onu JsonElement'e ayrıştırır.</summary>
    private static JsonElement ParseArguments(JsonElement functionCallItem)
    {
        if (functionCallItem.TryGetProperty("arguments", out var argEl))
        {
            if (argEl.ValueKind == JsonValueKind.String)
            {
                var raw = argEl.GetString();
                if (!string.IsNullOrWhiteSpace(raw))
                {
                    try
                    {
                        using var d = JsonDocument.Parse(raw);
                        return d.RootElement.Clone();
                    }
                    catch (JsonException) { /* model bozuk JSON üretti → boş args */ }
                }
            }
            else if (argEl.ValueKind == JsonValueKind.Object)
            {
                return argEl.Clone();
            }
        }

        using var empty = JsonDocument.Parse("{}");
        return empty.RootElement.Clone();
    }

    private Dictionary<string, object?> BuildPayload(object input, object[]? tools, bool includeTemperature, string? toolChoice = null)
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

        if (toolChoice is not null)
        {
            payload["tool_choice"] = toolChoice;
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
