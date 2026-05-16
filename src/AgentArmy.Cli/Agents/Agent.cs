namespace AgentArmy.Cli;

// IP0.2: Manifest behaviors — hardcoded ajan-ID kontrolleri yerine bu bayraklar kullanılır.
public sealed record AgentBehaviors
{
    /// Çalışmak için web araması / web erişimi gerektiren LLM client seçimini tetikler.
    public bool RequiresWebSearch     { get; init; }
    /// Mevcut tüm work içeriğini bağlam olarak alır (sadece önceki adım çıktısını değil).
    public bool RequiresFullContext   { get; init; }
    /// Çıktısını facts deposuna (FactsPath) yazar.
    public bool WritesToFacts         { get; init; }
    /// Çıktısını decisions deposuna (DecisionsPath) yazar.
    public bool WritesToDecisions     { get; init; }
    /// Denetçi raporu olarak işaretlenir; PASS/FAIL tespiti burada yapılır.
    public bool CapturesVerifierReport { get; init; }
    /// Bu adım tamamlandığında (contrarian:on aktifse) otomatik Contrarian adımı tetikler.
    public bool TriggersContrarian    { get; init; }
    /// Verifier rubrik dosyasını ekstra policy olarak alır.
    public bool AcceptsRubric         { get; init; }
    /// Domain allowlist'i (allowed-domains.txt) ekstra policy olarak alır.
    public bool PrefersDomainAllowlist { get; init; }
}

public sealed record Agent(string Id, string DisplayName, string SystemPrompt)
{
    public AgentBehaviors Behaviors  { get; init; } = new AgentBehaviors();
    public string RiskCeiling        { get; init; } = "R1";
    public string CostClass          { get; init; } = "low";
}

// Persona: DB'den yüklenen kimlik katmanı. BehaviorOverrides, core agent davranışlarının üstüne OR edilir.
// RiskCeiling null ise persona hiçbir kısıtlama getirmez; değer varsa core agent ceiling ile kıyaslanır, katısı kazanır.
public sealed record Persona(string Slug, string ContentMd)
{
    public AgentBehaviors BehaviorOverrides { get; init; } = new AgentBehaviors();
    public string?        RiskCeiling       { get; init; } = null;
    public string         CostClass         { get; init; } = "medium";
}

