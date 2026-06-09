namespace AgentArmy.Cli;

public static class Program
{
    public static async Task<int> Main(string[] args)
    {
        if (args.Length == 0)
        {
            Console.WriteLine(HelpText.Build());
            return 1;
        }

        // Sürüm damgası — worker logunda hangi binary'nin koştuğunu gözle doğrulamak için.
        // Yeni kod deploy olduysa bu satırı görmeli; görmüyorsan eski binary çalışıyordur.
        Console.Error.WriteLine("[AgentArmy] build-marker: tedarik-tools v3 (operator-exec + tool_choice=required)");

        var rootDir = RepoRootFinder.Find(AppContext.BaseDirectory);

        try
        {
            return await CommandDispatcher.ExecuteAsync(rootDir, args, CancellationToken.None);
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine(ex.Message);
            return 2;
        }
    }
}
