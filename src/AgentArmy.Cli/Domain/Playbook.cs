using System.Text.Json.Serialization;

namespace AgentArmy.Cli;

public sealed class Playbook
{
    [JsonPropertyName("id")] public required string Id { get; init; }
    [JsonPropertyName("title")] public required string Title { get; init; }
    [JsonPropertyName("defaultPersona")] public required string DefaultPersona { get; init; }
    [JsonPropertyName("steps")] public required List<PlaybookStep> Steps { get; init; }
}

public sealed class PlaybookStep
{
    [JsonPropertyName("id")] public required string Id { get; init; }
    [JsonPropertyName("agent")] public required string Agent { get; init; }
    [JsonPropertyName("goal")] public required string Goal { get; init; }
    [JsonPropertyName("output")] public required string Output { get; init; }

    [JsonPropertyName("image")] public ImageSpec? Image { get; init; }

    [JsonPropertyName("saveAs")] public string? SaveAs { get; init; }
}

public sealed class ImageSpec
{
    [JsonPropertyName("size")] public string? Size { get; init; }
    [JsonPropertyName("fileName")] public string? FileName { get; init; }
}
