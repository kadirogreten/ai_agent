-- IP1.5 Approval Queue: R2/R3 risk adımları için insan onay kuyruğu
-- Strateji §6.5: "R2 → Denetçi onayı + gerekçe; R3 → İnsan onayı zorunlu + geri alma planı"
-- Strateji §7.2: Onay Kuralı; KPI: P50 bekleme < 4 saat

CREATE TABLE IF NOT EXISTS public.approval_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id UUID NOT NULL,
  run_request_id UUID,
  step_index INTEGER NOT NULL DEFAULT 0,
  step_name TEXT,
  agent_code TEXT,
  risk_level TEXT NOT NULL CHECK (risk_level IN ('R2','R3')),
  action_summary TEXT NOT NULL,
  action_detail JSONB,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','approved','rejected','expired')),
  reviewer_id UUID,
  reviewer_note TEXT,
  decided_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + INTERVAL '24 hours'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_approval_queue_owner_status
  ON public.approval_queue(owner_user_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_approval_queue_run_request
  ON public.approval_queue(run_request_id);

CREATE INDEX IF NOT EXISTS idx_approval_queue_expires
  ON public.approval_queue(expires_at)
  WHERE status = 'pending';

ALTER TABLE public.approval_queue ENABLE ROW LEVEL SECURITY;

-- Kullanıcı kendi onay öğelerini görebilir; reviewer de görebilir
DROP POLICY IF EXISTS approval_queue_select_own ON public.approval_queue;
CREATE POLICY approval_queue_select_own ON public.approval_queue
  FOR SELECT TO authenticated
  USING (owner_user_id = auth.uid() OR reviewer_id = auth.uid());

-- Worker/sistem SECURITY DEFINER fonksiyon üzerinden INSERT yapar
-- Kullanıcı doğrudan INSERT yapamaz; sadece UPDATE (karar) yapabilir
DROP POLICY IF EXISTS approval_queue_update_reviewer ON public.approval_queue;
CREATE POLICY approval_queue_update_reviewer ON public.approval_queue
  FOR UPDATE TO authenticated
  USING (owner_user_id = auth.uid())
  WITH CHECK (owner_user_id = auth.uid());

GRANT SELECT, UPDATE ON TABLE public.approval_queue TO authenticated;

-- Worker erişimi için INSERT yetkisi (service_role veya özel role üzerinden)
GRANT INSERT ON TABLE public.approval_queue TO service_role;

-- Süresi dolan öğeleri 'expired' olarak işaretle
CREATE OR REPLACE FUNCTION public.expire_approval_queue()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  affected INTEGER;
BEGIN
  UPDATE public.approval_queue
  SET status = 'expired'
  WHERE status = 'pending'
    AND expires_at < now();

  GET DIAGNOSTICS affected = ROW_COUNT;
  RETURN affected;
END;
$$;

REVOKE ALL ON FUNCTION public.expire_approval_queue() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.expire_approval_queue() TO service_role;
