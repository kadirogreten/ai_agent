using System.Text;
using System.Text.Json;

namespace AgentArmy.Cli;

public sealed class FactsIndex
{
    private readonly string _jsonlPath;

    public FactsIndex(string jsonlPath)
    {
        _jsonlPath = jsonlPath;
    }

    public IReadOnlyList<FactEntry> Search(string query, int maxFacts)
    {
        if (!File.Exists(_jsonlPath)) return Array.Empty<FactEntry>();

        var tokens = Tokenize(query);
        if (tokens.Count == 0) return Array.Empty<FactEntry>();

        var scored = new List<(int Score, FactEntry Fact)>();

        using var stream = new FileStream(_jsonlPath, FileMode.Open, FileAccess.Read, FileShare.ReadWrite);
        using var reader = new StreamReader(stream, Encoding.UTF8);

        while (!reader.EndOfStream)
        {
            var line = reader.ReadLine();
            if (string.IsNullOrWhiteSpace(line)) continue;
            FactEntry? fact = null;
            try
            {
                fact = JsonSerializer.Deserialize<FactEntry>(line, new JsonSerializerOptions
                {
                    PropertyNameCaseInsensitive = true
                });
            }
            catch
            {
            }

            if (fact is null) continue;

            var hay = (fact.Claim + " " + fact.Topic + " " + fact.SourceDomain).ToLowerInvariant();
            var score = 0;
            foreach (var t in tokens)
            {
                if (hay.Contains(t)) score++;
            }

            if (score == 0) continue;
            scored.Add((score, fact));
        }

        return scored
            .OrderByDescending(x => x.Score)
            .ThenByDescending(x => x.Fact.Confidence)
            .Take(maxFacts)
            .Select(x => x.Fact)
            .ToArray();
    }

    private static HashSet<string> Tokenize(string text)
    {
        var set = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        if (string.IsNullOrWhiteSpace(text)) return set;

        var sb = new StringBuilder();
        foreach (var ch in text.ToLowerInvariant())
        {
            if (char.IsLetterOrDigit(ch))
            {
                sb.Append(ch);
                continue;
            }

            if (sb.Length > 2)
            {
                set.Add(sb.ToString());
            }
            sb.Clear();
        }

        if (sb.Length > 2) set.Add(sb.ToString());
        return set;
    }
}

