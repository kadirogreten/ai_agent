namespace AgentArmy.Cli;

/// <summary>
/// LLM boş <c>behaviors</c> döndürdüğünde persona adı + rol açıklamasından çıkarımla
/// makul varsayılan davranış overlay'i üretir. Bu, sektör keşfinden çıkan personaların
/// sıfır overlay ile "ölü" kalmasını engeller.
///
/// Mantık konservatif: sadece keyword eşleşirse bayrak true yapar; hiçbir bayrak
/// false (force-off) yapmaz. False/override için kullanıcı portal'dan elle ayarlamalı.
/// </summary>
public static class PersonaBehaviorsHeuristics
{
    /// <summary>
    /// Persona adı + role + slug'da geçen anahtar kelimelere göre overlay üretir.
    /// Hiçbir keyword eşleşmezse null döner (çekirdek davranış olduğu gibi geçer).
    /// </summary>
    public static AgentBehaviorsOverlay? Infer(string slug, string? name, string? roleDescription)
    {
        var haystack = ((slug ?? "") + " " + (name ?? "") + " " + (roleDescription ?? ""))
            .ToLowerInvariant();
        if (string.IsNullOrWhiteSpace(haystack)) return null;

        bool? web = null, fullCtx = null, facts = null, decisions = null,
              verifier = null, contrarian = null, rubric = null, allowlist = null;

        // Araştırmacı / researcher / market-intel
        if (ContainsAny(haystack, "araştır", "arastir", "research", "market-intel", "intel", "scout"))
        {
            web       = true;
            allowlist = true;
            facts     = true;
        }

        // Analist / analyst / data
        if (ContainsAny(haystack, "analist", "analyst", "analiz", "data scientist", "veri analiz"))
        {
            decisions = true;
        }

        // Denetçi / verifier / auditor / kontrol / kalite
        if (ContainsAny(haystack, "denetç", "denetc", "verifier", "auditor", "kontrol", "kalite", "quality"))
        {
            verifier = true;
            rubric   = true;
            fullCtx  = true;
        }

        // Editör / editor / kopya editör
        if (ContainsAny(haystack, "editör", "editor"))
        {
            fullCtx = true;
        }

        // Uyum / compliance / regülasyon / mevzuat
        if (ContainsAny(haystack, "uyum", "compliance", "regülasyon", "regulasyon", "mevzuat", "regulatory"))
        {
            rubric     = true;
            contrarian = true;
            allowlist  = true;
        }

        // Hukuk / legal / avukat / sözleşme
        if (ContainsAny(haystack, "hukuk", "legal", "avukat", "lawyer", "sözleş", "sozles"))
        {
            rubric    = true;
            allowlist = true;
            fullCtx   = true;
            contrarian = true;
        }

        // Finans / finance / muhasebe / accounting
        if (ContainsAny(haystack, "finans", "finance", "muhasebe", "accounting", "bütçe", "butce"))
        {
            decisions = true;
            rubric    = true;
            contrarian = true;
        }

        // Danışman / advisor / consultant / strateji
        if (ContainsAny(haystack, "danışman", "danisman", "advisor", "consultant", "strateji", "strategist"))
        {
            web       = true;
            fullCtx   = true;
        }

        // Yazar / writer / copywriter / içerik
        if (ContainsAny(haystack, "copywriter", "metin yazar", "içerik yazar", "icerik yazar", "content writer"))
        {
            // Yazarlar için çekirdek default'ları yeterli; özel bir overlay yok.
        }

        // Operasyon / operator / SOP
        if (ContainsAny(haystack, "operatör", "operator", "operasyon", "sop", "incident"))
        {
            decisions = true;
        }

        // İş analisti, PM (ürün yöneticisi)
        if (ContainsAny(haystack, "ürün yönetici", "urun yonetici", "product manager", "iş analist", "is analist"))
        {
            decisions = true;
            fullCtx   = true;
        }

        // Satış / sales / BD
        if (ContainsAny(haystack, "satış", "satis", "sales", "business development", "iş geliştir"))
        {
            decisions = true;
        }

        // Hiçbir keyword eşleşmediyse — sessizce null dön
        var overlay = new AgentBehaviorsOverlay
        {
            RequiresWebSearch      = web,
            RequiresFullContext    = fullCtx,
            WritesToFacts          = facts,
            WritesToDecisions      = decisions,
            CapturesVerifierReport = verifier,
            TriggersContrarian     = contrarian,
            AcceptsRubric          = rubric,
            PrefersDomainAllowlist = allowlist,
        };

        return overlay.HasAnyFlag() ? overlay : null;
    }

    private static bool ContainsAny(string haystack, params string[] needles)
    {
        foreach (var n in needles)
            if (haystack.Contains(n, System.StringComparison.OrdinalIgnoreCase))
                return true;
        return false;
    }
}
