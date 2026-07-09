using Xunit;

namespace AgentArmy.Cli.Tests;

public sealed class EmbeddingServiceTests
{
    [Fact]
    public void ToPgVectorLiteral_FormatsCorrectly()
    {
        var literal = EmbeddingService.ToPgVectorLiteral([0.5f, 1.25f, -0.1f]);
        Assert.Equal("[0.5,1.25,-0.1]", literal);
    }

    [Fact]
    public void EmbeddingService_WithoutApiKey_NotConfigured()
    {
        using var http = new HttpClient();
        var svc = new EmbeddingService(http, apiKey: "");
        Assert.False(svc.IsConfigured);
    }
}
