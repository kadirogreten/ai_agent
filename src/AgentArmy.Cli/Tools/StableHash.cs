using System.Text;

namespace AgentArmy.Cli;

// Proses/OS bağımsız deterministik seed — GetHashCode() kullanılmaz (PR-S5).

internal static class StableHash
{
    /// <summary>FNV-1a 32-bit — aynı girdi her koşumda aynı seed.</summary>
    public static uint Seed(string input)
    {
        const uint offset = 2166136261;
        const uint prime  = 16777619;
        var hash = offset;
        foreach (var b in Encoding.UTF8.GetBytes(input))
        {
            hash ^= b;
            hash *= prime;
        }
        return hash;
    }
}
