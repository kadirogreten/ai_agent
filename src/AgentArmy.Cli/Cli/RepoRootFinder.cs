namespace AgentArmy.Cli;

public static class RepoRootFinder
{
    public static string Find(string baseDir)
    {
        var dir = new DirectoryInfo(baseDir);
        while (dir is not null)
        {
            var candidate = Path.Combine(dir.FullName, "AgentArmy.sln");
            if (File.Exists(candidate)) return dir.FullName;
            dir = dir.Parent;
        }
        return Directory.GetCurrentDirectory();
    }
}

