using System.Text;

namespace AgentArmy.Cli;

public static class PromptBuilder
{
    public static string BuildSystemPrompt(Agent agent, string personaText, string? extraPolicy)
    {
        var sb = new StringBuilder();
        sb.AppendLine(agent.SystemPrompt);

        if (!string.IsNullOrWhiteSpace(extraPolicy))
        {
            sb.AppendLine();
            sb.AppendLine("Ek politika/rubrik:");
            sb.AppendLine(extraPolicy.Trim());
        }

        sb.AppendLine();
        sb.AppendLine("Persona bağlamı:");
        sb.AppendLine(personaText.Trim());
        return sb.ToString();
    }

    public static string BuildUserPrompt(RunContext ctx, PlaybookStep step, string priorWork)
    {
        var c = ctx.Contract;
        var sb = new StringBuilder();

        sb.AppendLine("Görev sözleşmesi:");
        sb.AppendLine($"- Persona: {c.Persona}");
        sb.AppendLine($"- Amaç: {c.Goal}");
        sb.AppendLine($"- Konu: {c.Topic}");
        sb.AppendLine($"- Teslimatlar: {c.Deliverables}");
        sb.AppendLine($"- Kapsam: {c.Scope}");
        sb.AppendLine($"- Kapsam dışı: {c.OutOfScope}");
        sb.AppendLine($"- Kalite kriterleri: {c.QualityCriteria}");
        sb.AppendLine($"- Risk seviyesi: {c.Risk}");
        sb.AppendLine($"- Araç izinleri: {c.ToolPermissions}");
        sb.AppendLine($"- Deadline: {c.Deadline}");
        sb.AppendLine();

        sb.AppendLine($"Playbook: {ctx.Playbook.Id} — {ctx.Playbook.Title}");
        sb.AppendLine($"Adım: {step.Id}");
        sb.AppendLine($"Hedef: {step.Goal}");
        sb.AppendLine($"Beklenen çıktı: {step.Output}");
        sb.AppendLine();

        if (!string.IsNullOrWhiteSpace(priorWork))
        {
            sb.AppendLine("Önceki çalışma (referans için):");
            sb.AppendLine(priorWork.Trim());
            sb.AppendLine();
        }

        sb.AppendLine("Kurallar:");
        sb.AppendLine("- Kaynaksız kritik iddia yazma; belirsizlikleri açıkça işaretle.");
        sb.AppendLine("- Sonucu sadece istenen formatta üret.");

        return sb.ToString();
    }
}
