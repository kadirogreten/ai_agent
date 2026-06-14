-- PR14: Sector Factory kapalı döngü.
-- 1. decide_prompts tablosu: scope UNIQUE, 5dk cache ile okunur.
-- 2. sector_factory playbook seed'leri (system pack, 3 faz).
-- 3. sector_factory decide prompt seed'i.
--
-- Adlandırma: tarih-damgalı düzen. RLS deseni: 20260611140000_operations.sql izlendi.
-- PlaybookStep formatı: {id, agent, goal, output} — PR6 tedarik-* seed'leri örnek alındı.
-- Araç slug'ları doğrulandı: web_scrape, product_search (cargo_track/link_check/purchase_order/stock_check/stock_replenish/file_store — tam liste).
-- domain_pack_draft_write araç OLARAK YOK; taslak yazımı Runner post-hook'u (DomainPackDraftWriter).
-- web_search araç OLARAK YOK; araştırma için web_scrape + product_search kullanılır.

-- ── 1. decide_prompts tablosu ────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.decide_prompts (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  scope      TEXT        NOT NULL UNIQUE,   -- 'base' | 'tedarik' | 'sector_factory'
  content    TEXT        NOT NULL,
  version    INT         NOT NULL DEFAULT 1,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.decide_prompts IS
  'Operasyon döngüsü DECIDE faz prompt parçaları. scope=base: genel kurallar; '
  'scope=<kind>: o operasyon tipine özgü faz kuralları. '
  'operationLoopTick.ts 5dk in-memory cache ile okur; sabit fallback hâlâ çalışır.';

ALTER TABLE public.decide_prompts ENABLE ROW LEVEL SECURITY;

CREATE POLICY dp_select_all ON public.decide_prompts
  FOR SELECT TO authenticated
  USING (true);

CREATE POLICY dp_service_role_all ON public.decide_prompts
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);

GRANT SELECT ON TABLE public.decide_prompts TO authenticated;
GRANT ALL    ON TABLE public.decide_prompts TO service_role;

-- ── 2. sector_factory playbook seed'leri ────────────────────────────────────
--
-- pack_id = 'system' (0020_domain_pack_architect.sql'de seed edilmiş).
-- tenant_id = NULL → platform geneli (tüm tenant'lara açık).
-- NOT: PostgreSQL UNIQUE nullable sütunlarda NULL≠NULL sayar; idempotency WHERE NOT EXISTS ile.
-- operationLoopTick.ts availablePlaybooks sorgusunda 'system' pack_id dahil edilmekte
--   (.in('pack_id', [op.domain_pack, 'system']) — doğrulandı).

-- Faz 1: Araştırma — sektör analizi, araç eşleşme, eksik araç tespiti
INSERT INTO public.playbooks (slug, pack_id, tenant_id, name, description, goal, steps, default_risk, required_tools)
SELECT
  'sector-arastirma',
  'system',
  NULL,
  'Sektör — Araştırma',
  'Hedef sektörde iş süreçleri, rol grupları, ağrı noktaları ve araç eşleşmesi araştırması.',
  'Sektörü anla; mevcut araçlarla örtüşen süreçleri ve eksik araçları tespit et.',
  '[
    {
      "id": "s1",
      "agent": "Operator",
      "goal": "web_scrape ile hedef sektördeki temel iş süreçlerini, rol gruplarını ve ağrı noktalarını araştır. En az 3 farklı kaynaktan veri topla; her kaynağın URL''sini kaydet.",
      "output": "Sektör araştırma özeti: temel süreçler, rol grupları, ağrı noktaları, kaynak URL listesi."
    },
    {
      "id": "s2",
      "agent": "Operator",
      "goal": "product_search ile piyasada var olan ilgili SaaS ve otomasyon araçlarını bul. AgentArmy araç kataloğundaki slug''lar (stock_check, link_check, purchase_order, web_scrape, product_search, cargo_track, file_store) ile hangi sektör süreçlerinin örtüştüğünü tablola.",
      "output": "Araç eşleşme tablosu: sektör süreci → uygun araç slug; katalogda karşılığı olmayan süreçler (eksik araç listesi)."
    },
    {
      "id": "s3",
      "agent": "Analyst",
      "goal": "Araştırma ve araç analizini birleştir. En kritik 3 süreci önceliklendir. Mevcut araç kapsamını ve eksik araç sayısını raporla.",
      "output": "Sektör analiz raporu: öncelikli 3 süreç, mevcut araç kapsamı yüzdesi, eksik araç listesi ve sayısı."
    }
  ]'::jsonb,
  'R1',
  ARRAY['web_scrape', 'product_search']
WHERE NOT EXISTS (
  SELECT 1 FROM public.playbooks
  WHERE slug = 'sector-arastirma' AND pack_id = 'system' AND tenant_id IS NULL
);

-- Faz 2: Taslak — DOMAIN_PACK_ARCHITECT ile domain pack üretimi; Verifier şema kontrolü
-- NOT: DomainPackDraftWriter Runner post-hook olarak çalışır (Runner.cs StartsWith("sector-")).
-- required_tools boş: DOMAIN_PACK_ARCHITECT araç çağrısı değil, ajan persona olarak çalışır.
INSERT INTO public.playbooks (slug, pack_id, tenant_id, name, description, goal, steps, default_risk, required_tools)
SELECT
  'sector-paket-taslak',
  'system',
  NULL,
  'Sektör — Paket Taslağı',
  'Araştırma raporundan domain pack taslağı üretimi (DOMAIN_PACK_ARCHITECT) + şema doğrulama.',
  'Araştırma çıktısından geçerli domain pack JSON taslağı oluştur; şemayı doğrula.',
  '[
    {
      "id": "s1",
      "agent": "DOMAIN_PACK_ARCHITECT",
      "goal": "Araştırma raporunu girdiye alarak bu sektör için eksiksiz bir domain pack tasarla: persona listesi (risk_ceiling, cost_class, behaviors), playbook adımları (id, agent, goal, output), glossary_md ve verifier_rubric_md. Çıktıyı geçerli JSON olarak yaz.",
      "output": "Domain pack JSON taslağı: personas dizisi, playbooks dizisi, glossary_md, verifier_rubric_md — tüm alanlar dolu."
    },
    {
      "id": "s2",
      "agent": "Verifier",
      "goal": "Taslak JSON''un şema gereksinimlerini kontrol et: personas ve playbooks dizileri boş değil mi? Her playbook adımında id, agent, goal, output alanları var mı? Glossary ve verifier_rubric dolu mu? Tüm gereksinimler karşılanıyorsa VERDICT: PASS yaz; herhangi bir eksik varsa VERDICT: FAIL ve eksik alan listesi yaz.",
      "output": "Şema doğrulama raporu: VERDICT: PASS veya VERDICT: FAIL + eksik alan listesi."
    }
  ]'::jsonb,
  'R2',
  ARRAY[]::text[]
WHERE NOT EXISTS (
  SELECT 1 FROM public.playbooks
  WHERE slug = 'sector-paket-taslak' AND pack_id = 'system' AND tenant_id IS NULL
);

-- Faz 3: Test — taslak tutarlılık analizi + nihai Verifier değerlendirmesi
INSERT INTO public.playbooks (slug, pack_id, tenant_id, name, description, goal, steps, default_risk, required_tools)
SELECT
  'sector-paket-test',
  'system',
  NULL,
  'Sektör — Paket Test',
  'Domain pack taslağının tutarlılık analizi ve nihai Verifier değerlendirmesi.',
  'Taslak playbook adımları tutarlı mı, araçlar katalogda mevcut mu, riskler uygun mu — değerlendir.',
  '[
    {
      "id": "s1",
      "agent": "Analyst",
      "goal": "Domain pack taslağını incele: her playbook adımının agent değeri mevcut katalog ajanlarından (Operator, Analyst, Writer, Verifier, DOMAIN_PACK_ARCHITECT) biri mi? required_tools listesindeki slug''lar gerçek araç kataloğunda var mı (stock_check, link_check, purchase_order, web_scrape, product_search, cargo_track, file_store, stock_replenish)? Persona risk_ceiling değerleri R0-R3 aralığında mı? Eksikleri listele.",
      "output": "Tutarlılık analizi: geçerli adım sayısı, geçersiz araç slug listesi, geçersiz persona risk değerleri, toplam eksik sayısı."
    },
    {
      "id": "s2",
      "agent": "Verifier",
      "goal": "Tutarlılık analizine göre nihai değerlendirme yap. Tüm adımlar geçerliyse, araçlar katalogda mevcutsa ve persona riskleri uygunsa VERDICT: PASS yaz. Herhangi bir eksik veya uyumsuzluk varsa VERDICT: FAIL + toplam eksik araç sayısı + düzeltme listesi yaz.",
      "output": "Nihai test sonucu: VERDICT: PASS veya VERDICT: FAIL + eksik araç sayısı + düzeltme önerileri."
    }
  ]'::jsonb,
  'R1',
  ARRAY[]::text[]
WHERE NOT EXISTS (
  SELECT 1 FROM public.playbooks
  WHERE slug = 'sector-paket-test' AND pack_id = 'system' AND tenant_id IS NULL
);

-- ── 3. sector_factory decide prompt seed'i ───────────────────────────────────
--
-- verifier_outcome küçük harf: runs.verifier_outcome CHECK ('pass','fail','warn') — PR12'de
-- büyük harf bug'ı yaşanmıştı; karşılaştırmalar küçük harfe göre yapılır.

INSERT INTO public.decide_prompts (scope, content, version)
SELECT
  'sector_factory',
  $prompt$## Sektör fabrikası faz kuralları (context_json.kind = ''sector_factory'')

Sektör fabrikası operasyonları üç faz playbook''una ayrılmıştır; doğru sırayla ilerle:

| Son playbook         | Durum                                                   | Aksiyon       | next_playbook        |
|----------------------|---------------------------------------------------------|---------------|----------------------|
| (yok / ilk tick)     | —                                                       | continue      | sector-arastirma     |
| sector-arastirma     | verifier_outcome = pass (veya bilgilendirici)           | continue      | sector-paket-taslak  |
| sector-arastirma     | verifier_outcome = fail (kritik)                        | retry (max 2) | sector-arastirma     |
| sector-paket-taslak  | verifier_outcome = pass                                 | continue      | sector-paket-test    |
| sector-paket-taslak  | verifier_outcome = fail                                 | retry (max 2) | sector-paket-taslak  |
| sector-paket-test    | verifier_outcome = pass                                 | wait_approval | null                 |
| sector-paket-test    | verifier_outcome = fail (ardışık ≤ 2 tur)              | continue      | sector-paket-taslak  |
| sector-paket-test    | verifier_outcome = fail (3+ ard arda başarısız)         | escalate      | null                 |
| (onay sonrası)       | pendingApprovals = 0, son playbook sector-paket-test    | done          | null                 |

Kritik kurallar:
- verifier_outcome karşılaştırmasını KÜÇÜK HARF ile yap (''pass'', ''fail'', ''warn'').
- next_playbook MUTLAKA "Mevcut playbook''lar" listesinden biri olmalı.
- action "done", "wait_approval" veya "escalate" ise next_playbook null olmalı.$prompt$,
  1
WHERE NOT EXISTS (
  SELECT 1 FROM public.decide_prompts WHERE scope = 'sector_factory'
);

NOTIFY pgrst, 'reload schema';
