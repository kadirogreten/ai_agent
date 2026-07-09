namespace AgentArmy.Cli;

/// <summary>MCP sunucu slug → credential platform slug (PR-S7a agnostik).</summary>
public static class PlatformCredentialMap
{
    private static readonly Dictionary<string, string> McpServerToPlatform =
        new(StringComparer.OrdinalIgnoreCase)
        {
            ["meta-social"] = "meta",
        };

    public static string? PlatformFromMcpServerSlug(string? mcpServerSlug)
        => string.IsNullOrWhiteSpace(mcpServerSlug)
            ? null
            : McpServerToPlatform.TryGetValue(mcpServerSlug, out var p) ? p : null;

    public static string? FallbackEnvForPlatform(string platform) => platform switch
    {
        "meta" => "META_ACCESS_TOKEN",
        "x"    => "X_ACCESS_TOKEN",
        _      => null,
    };
}
