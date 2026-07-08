-- PR-S4: Reklam katmanı — ad_spend_ledger + ads_campaign_* araçları + policy caps + playbook.
-- Cap guardrail araç içinde (IToolPreGate); activate.compensation = ads_campaign_pause.

-- ── 1. ad_spend_ledger ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.ad_spend_ledger (
  campaign_id      TEXT          PRIMARY KEY,
  owner_user_id    UUID          NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  platform         TEXT          NOT NULL,
  daily_budget     NUMERIC(12,2) NOT NULL,
  total_budget_cap NUMERIC(12,2) NOT NULL,
  spent            NUMERIC(12,2) NOT NULL DEFAULT 0,
  currency         TEXT          NOT NULL DEFAULT 'TRY',
  status           TEXT          NOT NULL DEFAULT 'paused'
    CHECK (status IN ('paused', 'active', 'stopped')),
  created_at       TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ   NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ad_spend_ledger_owner ON public.ad_spend_ledger(owner_user_id);

DROP TRIGGER IF EXISTS trg_ad_spend_ledger_updated_at ON public.ad_spend_ledger;
CREATE TRIGGER trg_ad_spend_ledger_updated_at
  BEFORE UPDATE ON public.ad_spend_ledger
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.ad_spend_ledger ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ad_spend_ledger_select_own ON public.ad_spend_ledger;
CREATE POLICY ad_spend_ledger_select_own ON public.ad_spend_ledger
  FOR SELECT TO authenticated USING (owner_user_id = auth.uid());

DROP POLICY IF EXISTS ad_spend_ledger_modify_own ON public.ad_spend_ledger;
CREATE POLICY ad_spend_ledger_modify_own ON public.ad_spend_ledger
  FOR ALL TO authenticated USING (owner_user_id = auth.uid()) WITH CHECK (owner_user_id = auth.uid());

DROP POLICY IF EXISTS ad_spend_ledger_service_all ON public.ad_spend_ledger;
CREATE POLICY ad_spend_ledger_service_all ON public.ad_spend_ledger
  FOR ALL USING (auth.role() = 'service_role');

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.ad_spend_ledger TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.ad_spend_ledger TO service_role;

-- ── 2. tools seed ────────────────────────────────────────────────────────────
INSERT INTO public.tools (
    slug, name, description, category, auth_type,
    side_effect, reversible, min_risk, compensation, config_schema
) VALUES
  (
    'ads_campaign_create',
    'Reklam Kampanyası Oluştur',
    'Kampanyayı platformda PAUSED durumda oluşturur ve ad_spend_ledger''a kaydeder (demo).',
    'communication', 'none',
    'write', true, 'R1', NULL,
    '{"type":"object","required":["platform","daily_budget","total_budget_cap"],"properties":{"platform":{"type":"string","enum":["facebook","instagram","x"]},"daily_budget":{"type":"number"},"total_budget_cap":{"type":"number"},"currency":{"type":"string"},"name":{"type":"string"}}}'
  ),
  (
    'ads_campaign_activate',
    'Reklam Kampanyası Aktive Et',
    'Onaylı kampanyayı aktive eder; harcama başlar (demo). R3 — cap kontrolü araç içinde, gate öncesi.',
    'communication', 'none',
    'write', true, 'R3', 'ads_campaign_pause',
    '{"type":"object","required":["campaign_id"],"properties":{"campaign_id":{"type":"string"}}}'
  ),
  (
    'ads_campaign_pause',
    'Reklam Kampanyası Duraklat',
    'Aktif kampanyayı duraklatır; compensation aracı (demo).',
    'communication', 'none',
    'write', true, 'R1', NULL,
    '{"type":"object","required":["campaign_id"],"properties":{"campaign_id":{"type":"string"}}}'
  )
ON CONFLICT (slug) DO UPDATE SET
    name          = EXCLUDED.name,
    description   = EXCLUDED.description,
    category      = EXCLUDED.category,
    auth_type     = EXCLUDED.auth_type,
    side_effect   = EXCLUDED.side_effect,
    reversible    = EXCLUDED.reversible,
    min_risk      = EXCLUDED.min_risk,
    compensation  = EXCLUDED.compensation,
    config_schema = EXCLUDED.config_schema,
    updated_at    = now();

-- ── 3. policy_settings — bütçe cap'leri ────────────────────────────────────
INSERT INTO public.policy_settings (owner_user_id, key, value, description)
SELECT NULL, 'ads.max_daily_budget', '5000'::jsonb,
  'Reklam: günlük bütçe üst limiti (TRY). ads_campaign_activate cap kontrolü.'
WHERE NOT EXISTS (
  SELECT 1 FROM public.policy_settings WHERE key = 'ads.max_daily_budget' AND owner_user_id IS NULL
);

INSERT INTO public.policy_settings (owner_user_id, key, value, description)
SELECT NULL, 'ads.max_total_budget', '50000'::jsonb,
  'Reklam: toplam bütçe cap üst limiti (TRY). ads_campaign_activate cap kontrolü.'
WHERE NOT EXISTS (
  SELECT 1 FROM public.policy_settings WHERE key = 'ads.max_total_budget' AND owner_user_id IS NULL
);

-- ── 4. reklam-kampanya-yayinla playbook ─────────────────────────────────────
INSERT INTO public.playbooks (slug, pack_id, tenant_id, name, description, goal, steps, default_risk, required_tools, tags)
SELECT
  'reklam-kampanya-yayinla',
  'sosyal-medya',
  NULL,
  'Reklam — Kampanya Yayınla',
  'Brief''ten paused kampanya oluşturma ve R3 onaylı aktivasyon.',
  'Kampanyayı paused oluştur; verifier onayı ve insan onayı sonrası aktive et. Cap kontrolü araç içinde; geri alma = pause.',
  '[
    {"id":"s1","agent":"Operator","goal":"ads_campaign_create ile kampanyayı PAUSED oluştur; daily_budget ve total_budget_cap zorunlu. Ledger kaydı açılır.","output":"Kampanya kaydı: campaign_id, platform, status=paused, bütçeler."},
    {"id":"s2","agent":"Verifier","goal":"Bütçe tutarlılığı ve brief uyumunu doğrula. Cap aşımı veya tutarsızlık varsa VERDICT: FAIL yaz.","output":"Onaylı aktivasyon özeti veya VERDICT: FAIL + eksikler.","blockOnVerifierFail":true},
    {"id":"s3","agent":"Operator","goal":"ads_campaign_activate ile onaylı kampanyayı aktive et. campaign_id argümanını geç. Gönderilen aktivasyon geri alınamaz; compensation ads_campaign_pause.","output":"Aktivasyon kaydı: campaign_id, status=active","primaryTool":"ads_campaign_activate","blockOnVerifierFail":true}
  ]'::jsonb,
  'R3',
  ARRAY['ads_campaign_create','ads_campaign_activate'],
  ARRAY['sosyal-medya','reklam','yayin']
WHERE NOT EXISTS (
  SELECT 1 FROM public.playbooks WHERE slug = 'reklam-kampanya-yayinla' AND pack_id = 'sosyal-medya' AND tenant_id IS NULL
);

NOTIFY pgrst, 'reload schema';
