using System.Net;
using System.Text;
using System.Text.Json;
using Xunit;

namespace AgentArmy.Cli.Tests;

// ── Stub HttpMessageHandler ───────────────────────────────────────────────────

/// <summary>
/// Test SupabaseWriter için stub handler. Önceden ayarlanmış yanıt döner.
/// PR10'da açılan internal SupabaseWriter(string, string, HttpMessageHandler) ctor'unu kullanır.
/// </summary>
internal sealed class StubHttpHandler(HttpStatusCode status, string body) : HttpMessageHandler
{
    private readonly HttpStatusCode _status = status;
    private readonly string _body = body;

    protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage req, CancellationToken ct)
    {
        var resp = new HttpResponseMessage(_status)
        {
            Content = new StringContent(_body, Encoding.UTF8, "application/json"),
        };
        return Task.FromResult(resp);
    }
}

// ── LlmProviderResolverTests ──────────────────────────────────────────────────

public sealed class LlmProviderResolverTests
{
    /// <summary>
    /// (a) null-DB → Fallback döner, model env veya "gpt-4.1" olur.
    /// </summary>
    [Fact]
    public async Task NullDb_ReturnsFallback()
    {
        var result = await LlmProviderResolver.ResolveAsync(db: null, "run", CancellationToken.None);

        Assert.Equal(LlmProviderResolver.Fallback.Slug, result.Slug);
        Assert.Equal("openai", result.Kind);
    }

    /// <summary>
    /// (b) DB döndüğünde kayıt varsa provider parse edilir.
    /// StubHttpHandler JSON döner → SupabaseWriter internal test ctor kullanılır.
    /// </summary>
    [Fact]
    public async Task DbWithRecord_ParsesProvider()
    {
        var json = JsonSerializer.Serialize(new[]
        {
            new
            {
                slug              = "gpt-5-frontier",
                display_name      = "GPT-5",
                api_base          = "https://api.openai.com",
                api_key_env       = "OPENAI_API_KEY",
                model_id          = "gpt-5",
                kind              = "openai",
                tier              = "frontier",
                max_decision_risk = "R3",
                enabled           = true,
                is_default_for    = new[] { "decide" },
            },
        });

        using var handler = new StubHttpHandler(HttpStatusCode.OK, json);
        using var db      = new SupabaseWriter("https://fake.supabase.co", "fake-key", handler);

        var result = await LlmProviderResolver.ResolveAsync(db, "decide", CancellationToken.None);

        Assert.Equal("gpt-5-frontier", result.Slug);
        Assert.Equal("gpt-5",          result.ModelId);
        Assert.Equal("frontier",        result.Tier);
        Assert.Equal("R3",              result.MaxDecisionRisk);
    }

    /// <summary>
    /// (c) DB boş dizi döndüğünde Fallback'e düşer.
    /// </summary>
    [Fact]
    public async Task DbEmptyArray_ReturnsFallback()
    {
        using var handler = new StubHttpHandler(HttpStatusCode.OK, "[]");
        using var db      = new SupabaseWriter("https://fake.supabase.co", "fake-key", handler);

        var result = await LlmProviderResolver.ResolveAsync(db, "run", CancellationToken.None);

        Assert.Equal(LlmProviderResolver.Fallback.Slug, result.Slug);
    }

    /// <summary>
    /// (d) Tier yetersizlik kontrolü: R3 run + max_decision_risk=R2 provider → R3 > R2.
    /// RiskLevel yardımcısı doğru sıralama yapmalı.
    /// </summary>
    [Fact]
    public void RiskLevel_OrderedCorrectly()
    {
        Assert.True(LlmProviderResolver.RiskLevel("R3") > LlmProviderResolver.RiskLevel("R2"));
        Assert.True(LlmProviderResolver.RiskLevel("R2") > LlmProviderResolver.RiskLevel("R1"));
        Assert.True(LlmProviderResolver.RiskLevel("R1") > LlmProviderResolver.RiskLevel("R0"));
        Assert.Equal(LlmProviderResolver.RiskLevel("R2"), LlmProviderResolver.RiskLevel("R2"));
    }

    /// <summary>
    /// (e) Tier yetersiz → Runner InvalidOperationException fırlatır.
    /// FakeLlmClient tabanlı entegrasyon yerine sadece mantık test edilir.
    /// </summary>
    [Fact]
    public void TierInsufficient_RunnerShouldReject()
    {
        var provider = LlmProviderResolver.Fallback with
        {
            Slug             = "basic-model",
            Tier             = "basic",
            MaxDecisionRisk  = "R1",
        };

        var contractRisk = "R2";

        // Runner'daki kontrol mantığını burada doğrula — doğrudan Runner.RunOneAsync çağrılmaz
        // (env bağımlılıkları). Aynı koşul:
        var shouldReject = LlmProviderResolver.RiskLevel(contractRisk)
                         > LlmProviderResolver.RiskLevel(provider.MaxDecisionRisk);

        Assert.True(shouldReject, "R2 run, R1 max_decision_risk sağlayıcıyı reddetmeli");
    }
}
