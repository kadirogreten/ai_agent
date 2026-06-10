using System.Text.Json.Serialization;

namespace AgentArmy.Cli;

public sealed class Playbook
{
    /// <summary>Faz 2.5+ şema sürümü; JSON’da yok veya ≤0 ise <see cref="ResolvedVersion"/> = 1.</summary>
    [JsonPropertyName("version")] public int? Version { get; init; }

    /// <summary>DB/geçiş için kullanılacak normalleştirilmiş sürüm.</summary>
    public int ResolvedVersion => Version is > 0 ? Version.Value : 1;

    [JsonPropertyName("id")] public required string Id { get; init; }
    [JsonPropertyName("title")] public required string Title { get; init; }
    [JsonPropertyName("defaultPersona")] public required string DefaultPersona { get; init; }
    /// <summary>
    /// CLI'da <c>--risk</c> verilmediyse görev sözleşmesinde kullanılır (R0–R3).
    /// </summary>
    [JsonPropertyName("defaultRisk")] public string? DefaultRisk { get; init; }
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

    /// <summary>
    /// true ise: bu adım başlamadan önce önceki Verifier çıktısı VERDICT: FAIL ise adım
    /// çalıştırılmaz ve run "blocked_by_verifier" olarak işaretlenir.
    /// Blok aksiyonu önlediği için bu adıma ait hiçbir compensation tetiklenmez.
    /// </summary>
    [JsonPropertyName("blockOnVerifierFail")] public bool BlockOnVerifierFail { get; init; }
}

public sealed class ImageSpec
{
    [JsonPropertyName("size")] public string? Size { get; init; }
    [JsonPropertyName("fileName")] public string? FileName { get; init; }
}
