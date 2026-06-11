-- PR7 Görev 1: policy_settings — yapılandırılabilir sistem sabitleri.
-- Global sabitler (owner_user_id IS NULL) + kullanıcı override'ları.
-- RLS: okuma global+kendi, yazma yalnız kendi.
-- NULL benzersizliği: PostgreSQL UNIQUE NULL≠NULL sayar (PR6 dersi); iki partial index kullanılır.
-- Adlandırma: tarih-damgalı düzen. RLS deseni: 20260611140000_operations.sql izlendi.

CREATE TABLE IF NOT EXISTS public.policy_settings (
  id            UUID         NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  owner_user_id UUID         REFERENCES auth.users(id) ON DELETE CASCADE, -- NULL = global
  key           TEXT         NOT NULL,
  value         JSONB        NOT NULL,
  description   TEXT,
  updated_at    TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- owner'a özel satırlar için UNIQUE (NULL değerler için de çalışır ama NULL'lar için ek index gerekir)
CREATE UNIQUE INDEX IF NOT EXISTS policy_settings_owner_key_idx
  ON public.policy_settings (owner_user_id, key)
  WHERE owner_user_id IS NOT NULL;

-- global satırlar: tek bir (NULL, key) çifti
CREATE UNIQUE INDEX IF NOT EXISTS policy_settings_global_key_idx
  ON public.policy_settings (key)
  WHERE owner_user_id IS NULL;

COMMENT ON TABLE public.policy_settings IS
  'Yapılandırılabilir sistem sabitleri. owner_user_id IS NULL = global varsayılan; '
  'dolu = kullanıcı override''ı. PolicyReader owner→global zinciriyle okur.';

-- RLS
ALTER TABLE public.policy_settings ENABLE ROW LEVEL SECURITY;

-- SELECT: kendi satırları + global satırlar
CREATE POLICY policy_settings_select ON public.policy_settings
  FOR SELECT TO authenticated
  USING (owner_user_id = auth.uid() OR owner_user_id IS NULL);

-- INSERT: yalnız kendi satırları
CREATE POLICY policy_settings_insert ON public.policy_settings
  FOR INSERT TO authenticated
  WITH CHECK (owner_user_id = auth.uid());

-- UPDATE: yalnız kendi satırları
CREATE POLICY policy_settings_update ON public.policy_settings
  FOR UPDATE TO authenticated
  USING  (owner_user_id = auth.uid())
  WITH CHECK (owner_user_id = auth.uid());

-- DELETE: yalnız kendi satırları
CREATE POLICY policy_settings_delete ON public.policy_settings
  FOR DELETE TO authenticated
  USING (owner_user_id = auth.uid());

-- ── Global seed'ler ───────────────────────────────────────────────────────────
-- İdempotent: partial index üzerinde WHERE NOT EXISTS kullanılır (NULL UNIQUE semantiği).

INSERT INTO public.policy_settings (owner_user_id, key, value, description)
SELECT NULL, 'riskgate.max_wait_hours', '4'::jsonb,
  'RiskGate: R2/R3 onay için maksimum bekleme süresi (saat). Varsayılan: 4.'
WHERE NOT EXISTS (SELECT 1 FROM public.policy_settings WHERE key = 'riskgate.max_wait_hours' AND owner_user_id IS NULL);

INSERT INTO public.policy_settings (owner_user_id, key, value, description)
SELECT NULL, 'riskgate.poll_seconds', '15'::jsonb,
  'RiskGate: onay kuyruğu yoklama aralığı (saniye). Varsayılan: 15.'
WHERE NOT EXISTS (SELECT 1 FROM public.policy_settings WHERE key = 'riskgate.poll_seconds' AND owner_user_id IS NULL);

INSERT INTO public.policy_settings (owner_user_id, key, value, description)
SELECT NULL, 'oploop.wait_approval_timeout_hours', '24'::jsonb,
  'OperationLoop: wait_approval zaman aşımı (saat). Varsayılan: 24.'
WHERE NOT EXISTS (SELECT 1 FROM public.policy_settings WHERE key = 'oploop.wait_approval_timeout_hours' AND owner_user_id IS NULL);

INSERT INTO public.policy_settings (owner_user_id, key, value, description)
SELECT NULL, 'selfreflect.fail_rate', '0.4'::jsonb,
  'SelfReflection: sinyal için minimum başarısızlık oranı (0–1). Varsayılan: 0.4.'
WHERE NOT EXISTS (SELECT 1 FROM public.policy_settings WHERE key = 'selfreflect.fail_rate' AND owner_user_id IS NULL);

INSERT INTO public.policy_settings (owner_user_id, key, value, description)
SELECT NULL, 'selfreflect.min_runs', '5'::jsonb,
  'SelfReflection: istatistiksel güvenilirlik için minimum run sayısı. Varsayılan: 5.'
WHERE NOT EXISTS (SELECT 1 FROM public.policy_settings WHERE key = 'selfreflect.min_runs' AND owner_user_id IS NULL);

INSERT INTO public.policy_settings (owner_user_id, key, value, description)
SELECT NULL, 'selfreflect.cooldown_hours', '24'::jsonb,
  'SelfReflection: aynı playbook için minimum sinyal aralığı (saat). Varsayılan: 24.'
WHERE NOT EXISTS (SELECT 1 FROM public.policy_settings WHERE key = 'selfreflect.cooldown_hours' AND owner_user_id IS NULL);

INSERT INTO public.policy_settings (owner_user_id, key, value, description)
SELECT NULL, 'memory.max_entries', '30'::jsonb,
  'Orchestrator: operasyon belleği maksimum giriş sayısı. Varsayılan: 30.'
WHERE NOT EXISTS (SELECT 1 FROM public.policy_settings WHERE key = 'memory.max_entries' AND owner_user_id IS NULL);

INSERT INTO public.policy_settings (owner_user_id, key, value, description)
SELECT NULL, 'cargo.stage_minutes', '[10,25,45,70,100]'::jsonb,
  'CargoTrackTool: demo kargo aşamaları için eşik dakikaları (5 eleman, artan sıra). Varsayılan: [10,25,45,70,100].'
WHERE NOT EXISTS (SELECT 1 FROM public.policy_settings WHERE key = 'cargo.stage_minutes' AND owner_user_id IS NULL);

NOTIFY pgrst, 'reload schema';
