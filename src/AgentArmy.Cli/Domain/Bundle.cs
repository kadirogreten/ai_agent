using System.Text.Json.Serialization;

namespace AgentArmy.Cli;

public sealed class Bundle
{
    /// <summary>Faz 2.5 şema sürümü; JSON’da yok veya ≤0 ise <see cref="ResolvedVersion"/> = 1.</summary>
    [JsonPropertyName("version")] public int? Version { get; init; }

    public int ResolvedVersion => Version is > 0 ? Version.Value : 1;

    [JsonPropertyName("id")] public required string Id { get; init; }
    [JsonPropertyName("title")] public required string Title { get; init; }
    [JsonPropertyName("playbooks")] public required List<string> Playbooks { get; init; }
}

