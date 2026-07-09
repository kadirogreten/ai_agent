using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;

namespace AgentArmy.Cli;

/// <summary>
/// D1c: OpenAI embedding servisi — facts yazımı ve vector arama için.
/// OPENAI_API_KEY yoksa no-op (token-overlap fallback devreye girer).
/// </summary>
public sealed class EmbeddingService
{
    private readonly HttpClient _http;
    private readonly string _apiKey;
    private readonly string _model;

    public EmbeddingService(HttpClient http, string? apiKey = null, string? model = null)
    {
        _http   = http;
        _apiKey = apiKey ?? Environment.GetEnvironmentVariable("OPENAI_API_KEY") ?? "";
        _model  = model  ?? "text-embedding-3-small";
    }

    public bool IsConfigured => !string.IsNullOrWhiteSpace(_apiKey);

    public async Task<float[]?> EmbedAsync(string text, CancellationToken ct)
    {
        if (!IsConfigured || string.IsNullOrWhiteSpace(text))
            return null;

        try
        {
            var body = JsonSerializer.Serialize(new
            {
                model = _model,
                input = text.Trim(),
            });

            using var req = new HttpRequestMessage(HttpMethod.Post, "https://api.openai.com/v1/embeddings")
            {
                Content = new StringContent(body, Encoding.UTF8, "application/json"),
            };
            req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", _apiKey);

            using var resp = await _http.SendAsync(req, ct);
            if (!resp.IsSuccessStatusCode)
            {
                var err = await resp.Content.ReadAsStringAsync(ct);
                Console.Error.WriteLine($"[EmbeddingService] {(int)resp.StatusCode}: {err[..Math.Min(200, err.Length)]}");
                return null;
            }

            using var doc = JsonDocument.Parse(await resp.Content.ReadAsStringAsync(ct));
            var data = doc.RootElement.GetProperty("data");
            if (data.GetArrayLength() == 0) return null;

            var embedding = data[0].GetProperty("embedding");
            var vec = new float[embedding.GetArrayLength()];
            var i = 0;
            foreach (var v in embedding.EnumerateArray())
                vec[i++] = (float)v.GetDouble();

            return vec;
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            Console.Error.WriteLine($"[EmbeddingService] embed hatası: {ex.Message}");
            return null;
        }
    }

    /// <summary>pgvector RPC için PostgreSQL vector literal formatı: [0.1,0.2,...]</summary>
    public static string ToPgVectorLiteral(float[] embedding)
    {
        var sb = new StringBuilder("[");
        for (var i = 0; i < embedding.Length; i++)
        {
            if (i > 0) sb.Append(',');
            sb.Append(embedding[i].ToString(System.Globalization.CultureInfo.InvariantCulture));
        }
        sb.Append(']');
        return sb.ToString();
    }
}
