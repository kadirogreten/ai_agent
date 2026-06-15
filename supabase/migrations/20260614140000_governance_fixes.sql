-- PR15: T4 yönetişim düzeltmeleri.
-- 1. runs.verifier_outcome CHECK → 'blocked_by_verifier' değeri eklendi.
--    (Orchestrator.cs blok durumunda bu değeri yazar; eski CHECK ihlal ediyordu.)
-- 2. policy_settings: oploop.cargo_poll_max = 30 (kargo bekleme döngüsü tavanı).
-- 3. decide_prompts scope='tedarik' → version=2:
--    blocked_by_verifier durumu + phase geri dönüş yasağı eklendi.
--
-- Kısıt adı: 0012_runs_cost_ledger.sql'de isimlendirilmemiş inline CHECK →
--   PostgreSQL otomatik adı 'runs_verifier_outcome_check'.
-- Adlandırma: tarih-damgalı düzen. RLS deseni değişmez.

-- ── 1. runs.verifier_outcome CHECK genişlet ───────────────────────────────────

ALTER TABLE public.runs
  DROP CONSTRAINT IF EXISTS runs_verifier_outcome_check;

ALTER TABLE public.runs
  ADD CONSTRAINT runs_verifier_outcome_check
    CHECK (verifier_outcome IN ('pass', 'fail', 'warn', 'blocked_by_verifier'));

COMMENT ON COLUMN public.runs.verifier_outcome IS
  'Verifier adım sonucu: pass | fail | warn | blocked_by_verifier. '
  'blocked_by_verifier: blockOnVerifierFail=true olan adım önceki FAIL nedeniyle çalıştırılmadı.';

-- ── 2. oploop.cargo_poll_max policy seed ────────────────────────────────────

INSERT INTO public.policy_settings (owner_user_id, key, value, description)
SELECT
  NULL,
  'oploop.cargo_poll_max',
  '30'::jsonb,
  'Kargo takip döngüsü maksimum poll sayısı. Bu sayıya ulaşılırsa operasyon escalate edilir. '
  'step_count tüketmez; context_json.cargo_poll_count ile izlenir.'
WHERE NOT EXISTS (
  SELECT 1 FROM public.policy_settings
  WHERE key = 'oploop.cargo_poll_max' AND owner_user_id IS NULL
);

-- ── 3. decide_prompts scope='tedarik' → version 2 ───────────────────────────
--
-- Değişiklikler:
--   a. blocked_by_verifier satırı: link doğrulama başarısız → araştırmaya dön.
--   b. Faz geri dönüş yasağı: phase 'cargo'/'replenish'/'done' iken tedarik-siparis ASLA.
--   c. verifier_outcome karşılaştırması küçük harf notu eklendi (PR12 bug'ı referansı).

UPDATE public.decide_prompts
SET
  content = $prompt$## Tedarik akışı faz kuralları (domain: e-ticaret, stok tetikli operasyonlar)
Tedarik operasyonları üç faz playbook''una ayrılmıştır; doğru sırayla ilerle.
verifier_outcome karşılaştırmalarını KÜÇÜK HARF ile yap (''pass'', ''fail'', ''blocked_by_verifier'').

### Faz geçiş tablosu

| Son playbook         | Durum                                              | Aksiyon       | next_playbook       |
|----------------------|----------------------------------------------------|---------------|---------------------|
| (yok / ilk tick)     | —                                                  | continue      | tedarik-arastirma   |
| tedarik-arastirma    | verifier_outcome = pass (veya bilgilendirici)      | continue      | tedarik-siparis     |
| tedarik-arastirma    | verifier_outcome = fail (kritik)                   | retry (max 2) | tedarik-arastirma   |
| tedarik-siparis      | pendingApprovals > 0                               | wait_approval | null                |
| tedarik-siparis      | verifier_outcome = blocked_by_verifier             | retry (max 2) | tedarik-arastirma   |
| tedarik-siparis      | completed, onay geldi, verifier pass               | continue      | tedarik-kargo       |
| tedarik-kargo        | son özet ''Teslim edildi'' içeriyor                | continue      | tedarik-kargo       |
| tedarik-kargo        | son özet ''Teslim edildi'' içermiyor               | continue      | tedarik-kargo       |
| tedarik-kargo        | cargo_poll_count tavan aşıldı                      | escalate      | null                |
| (teslim sonrası)     | phase=replenish veya stock_replenish başarılı      | done          | null                |

### KESİN YASAK — faz geri dönüş engeli
context_json.phase değeri ''cargo'', ''replenish'' veya ''done'' ise:
- tedarik-siparis ASLA önerilmez — escalate et.
- purchase_order içeren herhangi bir adım önerilmez — escalate et.
Gerekçe: teslim/kargo aşamasından geriye sipariş fazına dönmek ikinci PO üretir.$prompt$,
  version    = 2,
  updated_at = now()
WHERE scope = 'tedarik';

NOTIFY pgrst, 'reload schema';
