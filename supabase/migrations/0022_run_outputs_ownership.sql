-- 0022_run_outputs_ownership.sql
-- run_outputs ve run_events'e owner_user_id ekle; portal'dan kendi run'larını okuyabilsin.

ALTER TABLE public.run_outputs ADD COLUMN IF NOT EXISTS owner_user_id UUID;
ALTER TABLE public.run_events  ADD COLUMN IF NOT EXISTS owner_user_id UUID;

CREATE INDEX IF NOT EXISTS run_outputs_owner_created_idx ON public.run_outputs (owner_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS run_events_owner_created_idx  ON public.run_events  (owner_user_id, created_at DESC);

-- Authenticated kullanıcılar kendi run_outputs'larını okuyabilir
CREATE POLICY "run_outputs_select_own" ON public.run_outputs
  FOR SELECT TO authenticated
  USING (owner_user_id = auth.uid());

-- Authenticated kullanıcılar kendi run_events'larını okuyabilir
CREATE POLICY "run_events_select_own" ON public.run_events
  FOR SELECT TO authenticated
  USING (owner_user_id = auth.uid());

-- audit_log service-role write izni (worker insert için)
ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "audit_log_select_own" ON public.audit_log;
CREATE POLICY "audit_log_select_own" ON public.audit_log
  FOR SELECT TO authenticated
  USING (owner_user_id = auth.uid());
