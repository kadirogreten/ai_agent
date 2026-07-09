using System.Text.Json;

namespace AgentArmy.Cli;

/// <summary>
/// D1a: Upgrade-retry öncesi yan etki kontrolü — başarılı write/external invocation varsa retry atlanır.
/// </summary>
public static class SideEffectInvocationGuard
{
    public static async Task<bool> HasSuccessfulWriteOrExternalAsync(
        SupabaseWriter? db,
        string runId,
        string stepId,
        CancellationToken ct)
    {
        if (db is null || string.IsNullOrWhiteSpace(runId) || string.IsNullOrWhiteSpace(stepId))
            return false;

        try
        {
            var q = $"run_id=eq.{Uri.EscapeDataString(runId)}" +
                    $"&step_id=eq.{Uri.EscapeDataString(stepId)}" +
                    "&status=eq.succeeded" +
                    "&side_effect=in.(write,external)" +
                    "&select=id&limit=1";
            var json = await db.SelectAsync("tool_invocations", q, ct);
            return json.ValueKind == JsonValueKind.Array && json.GetArrayLength() > 0;
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine($"[SideEffectGuard] tool_invocations sorgusu başarısız: {ex.Message}");
            return true; // fail-closed: belirsizlikte retry yapma
        }
    }
}
