-- Birleşik onay kararı RPC'si.
-- Sorun: mevcut approve_run_request / reject_run_request, approval_queue.run_request_id NULL
-- olduğunda hata fırlatır. Tool seviyesindeki RiskGate (örn. purchase_order R3) onay satırını
-- run_request_id = NULL ile yazar; bu yüzden bu satırlar onaylanamıyordu.
--
-- decide_approval: hem tool-seviye (run_request_id NULL) hem job-seviye gate'leri onaylar/reddeder.
--  - approval_queue satırını günceller (RiskGate polling 'approved'/'rejected' durumunu bekler).
--  - run_request_id varsa, job'ı yeniden kuyruğa alır (approve) veya fail (reject) — eski davranış.

CREATE OR REPLACE FUNCTION public.decide_approval(
  p_approval_id   UUID,
  p_reviewer_id   UUID,
  p_decision      TEXT,                 -- 'approved' | 'rejected'
  p_reviewer_note TEXT DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_run_request_id UUID;
BEGIN
  IF p_decision NOT IN ('approved', 'rejected') THEN
    RAISE EXCEPTION 'Geçersiz karar: % (approved|rejected olmalı)', p_decision;
  END IF;

  UPDATE public.approval_queue
  SET status        = p_decision,
      reviewer_id   = p_reviewer_id,
      reviewer_note = p_reviewer_note,
      decided_at    = now()
  WHERE id            = p_approval_id
    AND status        = 'pending'
    AND owner_user_id = p_reviewer_id
  RETURNING run_request_id INTO v_run_request_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Onay bulunamadı, zaten karar verilmiş ya da sahibi değilsiniz (id=%)', p_approval_id;
  END IF;

  -- Job-seviye gate ise run_request'i de güncelle (tool-seviye gate'te v_run_request_id NULL).
  IF v_run_request_id IS NOT NULL THEN
    IF p_decision = 'approved' THEN
      UPDATE public.run_requests
      SET status          = 'pending',
          allow_high_risk = true,
          started_at      = NULL,
          updated_at      = now()
      WHERE id = v_run_request_id;
    ELSE
      UPDATE public.run_requests
      SET status        = 'fail',
          finished_at   = now(),
          updated_at    = now(),
          error_message = 'Reddedildi: ' || COALESCE(p_reviewer_note, 'gerekçe belirtilmedi')
      WHERE id = v_run_request_id;
    END IF;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.decide_approval FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.decide_approval TO authenticated;
