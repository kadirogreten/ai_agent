-- IP1.5b Approval Queue Enforcement
-- Strateji §6.5 / §7.2: R2/R3 adımlar gerçekten durdurulur, insan onayı alınana kadar çalışmaz.
-- Worker: gate_run_for_approval() ile job'ı 'waiting_approval' yapar.
-- Portal: approve/reject RPC ile atomik karar + re-queue.

-- ──────────────────────────────────────────────────────────────────────────────
-- 1. run_requests.status CHECK kısıtlamasını genişlet
-- ──────────────────────────────────────────────────────────────────────────────
ALTER TABLE run_requests
  DROP CONSTRAINT IF EXISTS run_requests_status_check;

ALTER TABLE run_requests
  ADD CONSTRAINT run_requests_status_check
  CHECK (status IN ('pending','running','success','fail','cancelled','waiting_approval'));

-- ──────────────────────────────────────────────────────────────────────────────
-- 2. gate_run_for_approval: Worker çağırır (service_role)
--    approval_queue kaydı açar + run_request'i 'waiting_approval' yapar.
-- ──────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.gate_run_for_approval(
  p_run_request_id  UUID,
  p_owner_user_id   UUID,
  p_risk_level      TEXT,
  p_action_summary  TEXT,
  p_step_index      INTEGER DEFAULT 0,
  p_step_name       TEXT    DEFAULT NULL,
  p_agent_code      TEXT    DEFAULT NULL,
  p_action_detail   JSONB   DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_approval_id UUID;
BEGIN
  INSERT INTO public.approval_queue (
    owner_user_id, run_request_id, risk_level, action_summary,
    step_index, step_name, agent_code, action_detail
  )
  VALUES (
    p_owner_user_id, p_run_request_id, p_risk_level, p_action_summary,
    p_step_index, p_step_name, p_agent_code, p_action_detail
  )
  RETURNING id INTO v_approval_id;

  UPDATE run_requests
  SET status     = 'waiting_approval',
      updated_at = now()
  WHERE id = p_run_request_id;

  RETURN v_approval_id;
END;
$$;

REVOKE ALL ON FUNCTION public.gate_run_for_approval FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.gate_run_for_approval TO service_role;

-- ──────────────────────────────────────────────────────────────────────────────
-- 3. approve_run_request: Portal kullanıcısı çağırır (authenticated)
--    Atomik: approval_queue approved + run_request pending + allow_high_risk=true
-- ──────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.approve_run_request(
  p_approval_id   UUID,
  p_reviewer_id   UUID,
  p_reviewer_note TEXT DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_run_request_id UUID;
BEGIN
  UPDATE public.approval_queue
  SET status      = 'approved',
      reviewer_id  = p_reviewer_id,
      reviewer_note = p_reviewer_note,
      decided_at   = now()
  WHERE id               = p_approval_id
    AND status           = 'pending'
    AND owner_user_id    = p_reviewer_id
  RETURNING run_request_id INTO v_run_request_id;

  IF v_run_request_id IS NULL THEN
    RAISE EXCEPTION 'Approval not found, already decided, or not owned by caller (id=%)', p_approval_id;
  END IF;

  -- Re-queue: pending + allow_high_risk etkinleştir
  UPDATE run_requests
  SET status         = 'pending',
      allow_high_risk = true,
      started_at     = NULL,
      updated_at     = now()
  WHERE id = v_run_request_id;
END;
$$;

REVOKE ALL ON FUNCTION public.approve_run_request FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.approve_run_request TO authenticated;

-- ──────────────────────────────────────────────────────────────────────────────
-- 4. reject_run_request: Portal kullanıcısı çağırır (authenticated)
--    Atomik: approval_queue rejected + run_request fail
-- ──────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.reject_run_request(
  p_approval_id   UUID,
  p_reviewer_id   UUID,
  p_reviewer_note TEXT DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_run_request_id UUID;
BEGIN
  UPDATE public.approval_queue
  SET status        = 'rejected',
      reviewer_id   = p_reviewer_id,
      reviewer_note = p_reviewer_note,
      decided_at    = now()
  WHERE id               = p_approval_id
    AND status           = 'pending'
    AND owner_user_id    = p_reviewer_id
  RETURNING run_request_id INTO v_run_request_id;

  IF v_run_request_id IS NULL THEN
    RAISE EXCEPTION 'Approval not found, already decided, or not owned by caller (id=%)', p_approval_id;
  END IF;

  UPDATE run_requests
  SET status        = 'fail',
      finished_at   = now(),
      updated_at    = now(),
      error_message = 'Reddedildi: ' || COALESCE(p_reviewer_note, 'gerekçe belirtilmedi')
  WHERE id = v_run_request_id;
END;
$$;

REVOKE ALL ON FUNCTION public.reject_run_request FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reject_run_request TO authenticated;

-- ──────────────────────────────────────────────────────────────────────────────
-- 5. waiting_approval job'larını bulabilmek için ek indeks
-- ──────────────────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_run_requests_waiting_approval
  ON run_requests(owner_user_id, created_at DESC)
  WHERE status = 'waiting_approval';
