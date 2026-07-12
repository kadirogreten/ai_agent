-- D4c: Public API keys + webhook endpoints + kapalı-doğar policy seeds.
-- Desen: 20260611140000_operations.sql (RLS), 20260712190000_d4b_a2a_card.sql (policy).

-- ── api_keys ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.api_keys (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name          TEXT        NOT NULL,
  key_prefix    TEXT        NOT NULL,
  key_hash      TEXT        NOT NULL,
  scopes        TEXT[]      NOT NULL DEFAULT '{}',
  enabled       BOOLEAN     NOT NULL DEFAULT true,
  last_used_at  TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.api_keys IS
  'D4c — Public API anahtarları. Düz metin yalnız create yanıtında bir kez; DB''de SHA-256 hash.';
COMMENT ON COLUMN public.api_keys.key_prefix IS
  'İlk 8 karakter (aak_xxxx…) — UI listeleme; doğrulama key_hash ile.';
COMMENT ON COLUMN public.api_keys.key_hash IS
  'SHA-256 hex of full plaintext key (aak_…).';

CREATE UNIQUE INDEX IF NOT EXISTS api_keys_hash_uidx
  ON public.api_keys (key_hash);

CREATE INDEX IF NOT EXISTS api_keys_owner_idx
  ON public.api_keys (owner_user_id);

ALTER TABLE public.api_keys ENABLE ROW LEVEL SECURITY;

CREATE POLICY api_keys_select_own ON public.api_keys
  FOR SELECT TO authenticated
  USING (owner_user_id = auth.uid());

CREATE POLICY api_keys_insert_own ON public.api_keys
  FOR INSERT TO authenticated
  WITH CHECK (owner_user_id = auth.uid());

CREATE POLICY api_keys_update_own ON public.api_keys
  FOR UPDATE TO authenticated
  USING (owner_user_id = auth.uid())
  WITH CHECK (owner_user_id = auth.uid());

CREATE POLICY api_keys_delete_own ON public.api_keys
  FOR DELETE TO authenticated
  USING (owner_user_id = auth.uid());

CREATE POLICY api_keys_service_role_all ON public.api_keys
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.api_keys TO authenticated;
GRANT ALL ON TABLE public.api_keys TO service_role;

-- ── webhook_endpoints ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.webhook_endpoints (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id   UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  url             TEXT        NOT NULL,
  secret_enc      TEXT        NOT NULL,
  events          TEXT[]      NOT NULL DEFAULT ARRAY['operation.done','operation.escalated'],
  enabled         BOOLEAN     NOT NULL DEFAULT true,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.webhook_endpoints IS
  'D4c — Owner webhook URL''leri. secret_enc: AES-GCM (tokenEncryptor) veya plain: (dev).';
COMMENT ON COLUMN public.webhook_endpoints.events IS
  'operation.done | operation.escalated';

CREATE INDEX IF NOT EXISTS webhook_endpoints_owner_idx
  ON public.webhook_endpoints (owner_user_id)
  WHERE enabled = true;

ALTER TABLE public.webhook_endpoints ENABLE ROW LEVEL SECURITY;

CREATE POLICY webhook_endpoints_select_own ON public.webhook_endpoints
  FOR SELECT TO authenticated
  USING (owner_user_id = auth.uid());

CREATE POLICY webhook_endpoints_insert_own ON public.webhook_endpoints
  FOR INSERT TO authenticated
  WITH CHECK (owner_user_id = auth.uid());

CREATE POLICY webhook_endpoints_update_own ON public.webhook_endpoints
  FOR UPDATE TO authenticated
  USING (owner_user_id = auth.uid())
  WITH CHECK (owner_user_id = auth.uid());

CREATE POLICY webhook_endpoints_delete_own ON public.webhook_endpoints
  FOR DELETE TO authenticated
  USING (owner_user_id = auth.uid());

CREATE POLICY webhook_endpoints_service_role_all ON public.webhook_endpoints
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.webhook_endpoints TO authenticated;
GRANT ALL ON TABLE public.webhook_endpoints TO service_role;

-- ── Policy seeds (kapalı doğ) ────────────────────────────────────────────────
INSERT INTO public.policy_settings (owner_user_id, key, value, description)
SELECT NULL, 'public_api.enabled', 'false'::jsonb,
  'D4c — Public API kapısı. false iken POST/GET /api/v1/* 503. Açma: owner/global override (insan).'
WHERE NOT EXISTS (
  SELECT 1 FROM public.policy_settings
  WHERE key = 'public_api.enabled' AND owner_user_id IS NULL
);

INSERT INTO public.policy_settings (owner_user_id, key, value, description)
SELECT NULL, 'public_api.rate_limit_per_minute', '30'::jsonb,
  'D4c — API key başına dakikalık istek tavanı.'
WHERE NOT EXISTS (
  SELECT 1 FROM public.policy_settings
  WHERE key = 'public_api.rate_limit_per_minute' AND owner_user_id IS NULL
);
