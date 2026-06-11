using System.Text;

namespace AgentArmy.Cli;

public static class PromptBuilder
{
    public static string BuildSystemPrompt(
        Agent   agent,
        string  personaText,
        string? extraPolicy,
        string? operationMemory = null)
    {
        var sb = new StringBuilder();
        sb.AppendLine(agent.SystemPrompt);

        if (!string.IsNullOrWhiteSpace(extraPolicy))
        {
            sb.AppendLine();
            sb.AppendLine("Ek politika/rubrik:");
            sb.AppendLine(extraPolicy.Trim());
        }

        // Operasyon belleği: run'lar arası taşınan kararlar ve bulgular.
        // Sistem prompt'una enjekte edilir — her adımda görünür, kullanıcı prompt'uyla tekrarlanmaz.
        if (!string.IsNullOrWhiteSpace(operationMemory))
        {
            sb.AppendLine();
            sb.AppendLine("## Operasyon belleği");
            sb.AppendLine("(Bu operasyonun önceki run'larından taşınan kararlar ve bulgular — doğrulanmış kabul et, tekrar kanıtlamaya çalışma)");
            sb.AppendLine(operationMemory.Trim());
        }

        sb.AppendLine();
        sb.AppendLine("Persona bağlamı:");
        sb.AppendLine(personaText.Trim());
        return sb.ToString();
    }

    public static string BuildUserPrompt(RunContext ctx, PlaybookStep step, string priorWork, string? priorFacts = null)
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

        if (!string.IsNullOrWhiteSpace(priorFacts))
        {
            sb.AppendLine("Önceki run'lardan kalıcı bulgular (kurumsal hafıza — doğrulanmış kabul edilebilir):");
            sb.AppendLine(priorFacts.Trim());
            sb.AppendLine();
        }

        if (!string.IsNullOrWhiteSpace(priorWork))
        {
            sb.AppendLine("Önceki çalışma (referans için):");
            sb.AppendLine(priorWork.Trim());
            sb.AppendLine();
        }

        sb.AppendLine("Kurallar:");
        sb.AppendLine("- Kaynaksız kritik iddia yazma; belirsizlikleri açıkça işaretle.");
        sb.AppendLine("- Geçmiş bulgular varsa onları tekrar kanıtlamaya çalışma; üzerine inşa et.");
        sb.AppendLine("- Sonucu sadece istenen formatta üret.");

        return sb.ToString();
    }
}
