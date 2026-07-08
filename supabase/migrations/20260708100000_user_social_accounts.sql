-- PR-S7a: Platform-agnostik sosyal hesap credential tablosu (Meta ilk provider).
-- Token'lar AES-256-GCM ciphertext olarak saklanır; düz metin yok.
-- CLI service_role + CredentialResolver; portal OAuth callback service_role upsert.

CREATE TABLE IF NOT EXISTS public.user_social_accounts (
  id                       UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id            UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  platform                 TEXT        NOT NULL
    CHECK (platform IN ('meta', 'x', 'linkedin', 'tiktok', 'google_ads')),
  external_account_id      TEXT        NOT NULL,
  scopes                   TEXT[]      NOT NULL DEFAULT '{}',
  access_token_ciphertext  TEXT        NOT NULL,
  refresh_token_ciphertext TEXT,
  expires_at               TIMESTAMPTZ,
  status                   TEXT        NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'revoked', 'error')),
  metadata                 JSONB       NOT NULL DEFAULT '{}',
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (owner_user_id, platform, external_account_id)
);

CREATE INDEX IF NOT EXISTS idx_user_social_accounts_owner_platform
  ON public.user_social_accounts(owner_user_id, platform);

CREATE INDEX IF NOT EXISTS idx_user_social_accounts_expires
  ON public.user_social_accounts(expires_at)
  WHERE status = 'active';

DROP TRIGGER IF EXISTS trg_user_social_accounts_updated_at ON public.user_social_accounts;
CREATE TRIGGER trg_user_social_accounts_updated_at
  BEFORE UPDATE ON public.user_social_accounts
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.user_social_accounts ENABLE ROW LEVEL SECURITY;

-- Portal UI: sahibi kendi satırlarını görür (ciphertext client'ta gösterilmez).
DROP POLICY IF EXISTS user_social_accounts_select_own ON public.user_social_accounts;
CREATE POLICY user_social_accounts_select_own ON public.user_social_accounts
  FOR SELECT TO authenticated
  USING (owner_user_id = auth.uid());

DROP POLICY IF EXISTS user_social_accounts_update_own ON public.user_social_accounts;
CREATE POLICY user_social_accounts_update_own ON public.user_social_accounts
  FOR UPDATE TO authenticated
  USING (owner_user_id = auth.uid())
  WITH CHECK (owner_user_id = auth.uid());

DROP POLICY IF EXISTS user_social_accounts_service_all ON public.user_social_accounts;
CREATE POLICY user_social_accounts_service_all ON public.user_social_accounts
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);

GRANT SELECT, UPDATE ON TABLE public.user_social_accounts TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.user_social_accounts TO service_role;

COMMENT ON TABLE public.user_social_accounts IS
  'Platform-agnostik OAuth token deposu. PR-S8 yeni platform = yeni platform değeri, tablo değişmez.';

-- PostgREST şema önbelleğini yenile — yeni tablo REST API'de hemen görünsün.
NOTIFY pgrst, 'reload schema';
