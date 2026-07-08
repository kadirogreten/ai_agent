-- PR-S7c: OAuth app kimlik bilgileri (App ID / App Secret / redirect URI) panelden yönetilir.
-- Kök şifreleme anahtarı SOCIAL_TOKEN_ENC_KEY env'de KALIR; app_secret AES-256-GCM ile
-- şifrelenip bu tabloda saklanır (tokenEncryptor.ts / TokenEncryptor.cs wire format).
-- Çözümleme sırası (portal/api/lib/social/oauthApps.ts): owner satırı → platform geneli → env fallback.
--
-- GÜVENLİK: authenticated rolüne HİÇBİR policy/grant verilmez — app_secret_ciphertext
-- PostgREST üzerinden kullanıcı JWT'siyle OKUNAMAZ. Tüm erişim portal API (service_role)
-- üzerinden; GET yanıtları secret'ı asla içermez (secret_set boolean döner).
-- Desen: 20260708100000_user_social_accounts.sql (şifreleme), 20260614110000_mcp_servers.sql (partial unique).

CREATE TABLE IF NOT EXISTS public.social_oauth_apps (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id         UUID        REFERENCES auth.users(id) ON DELETE CASCADE,  -- NULL = platform geneli varsayılan
  platform              TEXT        NOT NULL
                                    CHECK (platform IN ('meta','x','linkedin','tiktok','google_ads')),
  app_id                TEXT        NOT NULL,
  app_secret_ciphertext TEXT        NOT NULL,   -- AES-256-GCM (SOCIAL_TOKEN_ENC_KEY)
  redirect_uri          TEXT,
  enabled               BOOLEAN     NOT NULL DEFAULT true,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.social_oauth_apps IS
  'Platform OAuth app kayıtları (panelden yönetilir). app_secret şifreli; '
  'authenticated erişimi YOK — yalnız portal API (service_role). '
  'PR-S8: yeni platform = CHECK listesine değer + provider modülü, tablo değişmez.';

-- Benzersizlik: platform geneli tek satır; owner başına platform başına tek satır.
CREATE UNIQUE INDEX IF NOT EXISTS social_oauth_apps_platform_idx
  ON public.social_oauth_apps (platform)
  WHERE owner_user_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS social_oauth_apps_owner_platform_idx
  ON public.social_oauth_apps (owner_user_id, platform)
  WHERE owner_user_id IS NOT NULL;

DROP TRIGGER IF EXISTS trg_social_oauth_apps_updated_at ON public.social_oauth_apps;
CREATE TRIGGER trg_social_oauth_apps_updated_at
  BEFORE UPDATE ON public.social_oauth_apps
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.social_oauth_apps ENABLE ROW LEVEL SECURITY;

-- Yalnız service_role — authenticated policy bilinçli olarak YOK (secret koruması).
DROP POLICY IF EXISTS social_oauth_apps_service_all ON public.social_oauth_apps;
CREATE POLICY social_oauth_apps_service_all ON public.social_oauth_apps
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.social_oauth_apps TO service_role;

-- PostgREST şema önbelleğini yenile.
NOTIFY pgrst, 'reload schema';
