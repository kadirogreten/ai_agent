using System.Text.Json.Serialization;

namespace AgentArmy.Cli;

public sealed class Bundle
{
    [JsonPropertyName("id")] public required string Id { get; init; }
    [JsonPropertyName("title")] public required string Title { get; init; }
    [JsonPropertyName("playbooks")] public required List<string> Playbooks { get; init; }
}

