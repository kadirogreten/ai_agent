-- IP1.6 Audit Log: 90 gün immutable denetim kaydı
-- Yol Haritası Faz 1: "90 gün immutable retention" + "Audit Log query latency P95 < 500 ms"
-- Strateji §2.4 Yönetişim Katmanı: "loglama, denetim, geri alma mekanizmaları"
-- Strateji §7.1 Risk: tüm R0–R3 eylemleri izlenir

CREATE TABLE IF NOT EXISTS public.audit_log (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id  UUID        NOT NULL,
  actor_type     TEXT        NOT NULL CHECK (actor_type IN ('user','worker','system','agent')),
  actor_id       TEXT        NOT NULL,    -- user UUID, worker id, agent code
  action         TEXT        NOT NULL,    -- 'run.start', 'approval.approved', 'agent.create' …
  resource_type  TEXT,                    -- 'run','run_request','agent','bundle','fact','approval_queue'
  resource_id    UUID,
  risk_level     TEXT        CHECK (risk_level IN ('R0','R1','R2','R3')),
  severity       TEXT        NOT NULL DEFAULT 'info'
                             CHECK (severity IN ('info','warn','error')),
  detail         JSONB,                   -- ek bağlam / diff
  ip_address     TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Ana listeleme indeksi: P95 < 500 ms için
CREATE INDEX IF NOT EXISTS idx_audit_log_owner_created
  ON public.audit_log(owner_user_id, created_at DESC);

-- Kaynak türüne göre filtre
CREATE INDEX IF NOT EXISTS idx_audit_log_resource
  ON public.audit_log(owner_user_id, resource_type, created_at DESC);

-- Eylem adına göre filtre
CREATE INDEX IF NOT EXISTS idx_audit_log_action
  ON public.audit_log(owner_user_id, action, created_at DESC);

-- Risk seviyesine göre filtre
CREATE INDEX IF NOT EXISTS idx_audit_log_risk
  ON public.audit_log(owner_user_id, risk_level, created_at DESC);

-- Şiddet filtresi (warn/error hızlı arama)
CREATE INDEX IF NOT EXISTS idx_audit_log_severity
  ON public.audit_log(owner_user_id, severity, created_at DESC);

ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;

-- Sadece okuma: sahibi kendi kayıtlarını görebilir
DROP POLICY IF EXISTS audit_log_select_own ON public.audit_log;
CREATE POLICY audit_log_select_own ON public.audit_log
  FOR SELECT TO authenticated
  USING (owner_user_id = auth.uid());

-- Immutable: authenticated kullanıcı UPDATE/DELETE yapamaz
-- INSERT sadece service_role veya aşağıdaki SECURITY DEFINER fonksiyon üzerinden

GRANT SELECT ON TABLE public.audit_log TO authenticated;
GRANT INSERT ON TABLE public.audit_log TO service_role;

-- ─────────────────────────────────────────────────
-- Uygulama tarafından güvenli INSERT fonksiyonu
-- ─────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.append_audit_log(
  p_owner_user_id UUID,
  p_actor_type    TEXT,
  p_actor_id      TEXT,
  p_action        TEXT,
  p_resource_type TEXT        DEFAULT NULL,
  p_resource_id   UUID        DEFAULT NULL,
  p_risk_level    TEXT        DEFAULT NULL,
  p_severity      TEXT        DEFAULT 'info',
  p_detail        JSONB       DEFAULT NULL,
  p_ip_address    TEXT        DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_id UUID;
BEGIN
  INSERT INTO public.audit_log (
    owner_user_id, actor_type, actor_id, action,
    resource_type, resource_id, risk_level, severity,
    detail, ip_address
  ) VALUES (
    p_owner_user_id, p_actor_type, p_actor_id, p_action,
    p_resource_type, p_resource_id, p_risk_level, p_severity,
    p_detail, p_ip_address
  ) RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.append_audit_log FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.append_audit_log TO authenticated;
GRANT EXECUTE ON FUNCTION public.append_audit_log TO service_role;

-- ─────────────────────────────────────────────────
-- 90 gün retention: eski kayıtları silen fonksiyon
-- (Supabase Edge Function veya pg_cron ile günlük çağrılır)
-- ─────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.purge_audit_log(p_days INTEGER DEFAULT 90)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  affected INTEGER;
BEGIN
  DELETE FROM public.audit_log
  WHERE created_at < now() - (p_days || ' days')::INTERVAL;

  GET DIAGNOSTICS affected = ROW_COUNT;
  RETURN affected;
END;
$$;

REVOKE ALL ON FUNCTION public.purge_audit_log FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.purge_audit_log TO service_role;
