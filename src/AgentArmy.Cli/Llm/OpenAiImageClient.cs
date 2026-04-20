using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;

namespace AgentArmy.Cli;

public sealed class OpenAiImageClient
{
    private readonly HttpClient _http;
    private readonly string _apiKey;

    public OpenAiImageClient(HttpClient http, string apiKey)
    {
        _http = http;
        _apiKey = apiKey;
    }

    public async Task<byte[]> GeneratePngAsync(string prompt, string size, CancellationToken ct)
    {
        var req = new HttpRequestMessage(HttpMethod.Post, "https://api.openai.com/v1/images/generations");
        req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", _apiKey);

        var body = new
        {
            model = "gpt-image-1",
            prompt,
            size
        };

        req.Content = new StringContent(JsonSerializer.Serialize(body), Encoding.UTF8, "application/json");
        var res = await _http.SendAsync(req, ct);

        var json = await res.Content.ReadAsStringAsync(ct);
        if (!res.IsSuccessStatusCode)
        {
            throw new InvalidOperationException($"OpenAI image generation failed ({(int)res.StatusCode}). {json}");
        }

        using var doc = JsonDocument.Parse(json);
        if (!doc.RootElement.TryGetProperty("data", out var data) || data.ValueKind != JsonValueKind.Array)
        {
            throw new InvalidOperationException("OpenAI image generation response missing data.");
        }

        foreach (var item in data.EnumerateArray())
        {
            if (item.TryGetProperty("b64_json", out var b64) && b64.ValueKind == JsonValueKind.String)
            {
                return Convert.FromBase64String(b64.GetString() ?? string.Empty);
            }
        }

        throw new InvalidOperationException("OpenAI image generation response did not include b64_json.");
    }
}

