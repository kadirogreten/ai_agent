using System.Text.Json;
using Xunit;

namespace AgentArmy.Cli.Tests;

/// <summary>PR-D0a — untrusted sarması ve registry.</summary>
public sealed class ToolResultDelimiterTests
{
    [Fact]
    public void WrapUntrusted_IncludesTagAndSource()
    {
        const string payload = "{\"items\":[{\"text\":\"test\"}]}";
        var wrapped = ToolResultDelimiter.WrapUntrusted(payload, "social_inbox_fetch");

        Assert.Contains("<untrusted_data source=\"tool:social_inbox_fetch\">", wrapped);
        Assert.Contains("</untrusted_data>", wrapped);
        Assert.Contains("DIŞ VERİ", wrapped);
        Assert.Contains(payload, wrapped);
    }

    [Fact]
    public void WrapForTool_UntrustedSlug_UsesUntrustedWrapper()
    {
        var text = ToolResultDelimiter.WrapForTool("web_scrape", "body", untrustedSource: true);
        Assert.Contains("<untrusted_data", text);
    }

    [Fact]
    public void Registry_KnownSlugs_AreUntrusted()
    {
        Assert.True(ToolUntrustedRegistry.IsUntrusted("social_inbox_fetch"));
        Assert.False(ToolUntrustedRegistry.IsUntrusted("file_store"));
    }
}
