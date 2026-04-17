using System.Text;
using System.Text.Json;

namespace AgentArmy.Cli;

public sealed class FactsStore
{
    private readonly string _path;

    public FactsStore(string path)
    {
        _path = path;
    }

    public async Task<int> AppendUniqueAsync(IEnumerable<FactEntry> facts, CancellationToken ct)
    {
        Directory.CreateDirectory(Path.GetDirectoryName(_path)!);
        var existing = await LoadIdsAsync(ct);

        var appended = 0;
        await using var stream = new FileStream(_path, FileMode.OpenOrCreate, FileAccess.Write, FileShare.Read);
        stream.Seek(0, SeekOrigin.End);
        await using var writer = new StreamWriter(stream, Encoding.UTF8);

        foreach (var fact in facts)
        {
            if (existing.Contains(fact.Id)) continue;
            var json = JsonSerializer.Serialize(fact);
            await writer.WriteLineAsync(json.AsMemory(), ct);
            existing.Add(fact.Id);
            appended++;
        }

        await writer.FlushAsync();
        return appended;
    }

    private async Task<HashSet<string>> LoadIdsAsync(CancellationToken ct)
    {
        var set = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        if (!File.Exists(_path)) return set;

        using var stream = new FileStream(_path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite);
        using var reader = new StreamReader(stream, Encoding.UTF8);
        while (!reader.EndOfStream)
        {
            var line = await reader.ReadLineAsync(ct);
            if (string.IsNullOrWhiteSpace(line)) continue;
            try
            {
                using var doc = JsonDocument.Parse(line);
                if (doc.RootElement.TryGetProperty("Id", out var id) && id.ValueKind == JsonValueKind.String)
                {
                    var s = id.GetString();
                    if (!string.IsNullOrWhiteSpace(s)) set.Add(s);
                }
            }
            catch
            {
            }
        }

        return set;
    }
}

