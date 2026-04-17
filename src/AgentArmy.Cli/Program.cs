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
