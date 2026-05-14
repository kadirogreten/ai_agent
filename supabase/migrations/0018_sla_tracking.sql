-- IP1.3: Worker SLA — P95 < 30 sn
-- attempt_count + sla_breach takibi + stale job cleanup fonksiyonu

-- ──────────────────────────────────────────────────────────────────────────────
-- 1. run_requests SLA kolonları
-- ──────────────────────────────────────────────────────────────────────────────
ALTER TABLE run_requests
  ADD COLUMN IF NOT EXISTS attempt_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS sla_breach    BOOLEAN NOT NULL DEFAULT false;

-- attempt_count için indeks (yüksek deneme sayısı analizi)
CREATE INDEX IF NOT EXISTS idx_run_requests_attempt_count
  ON run_requests(attempt_count DESC)
  WHERE attempt_count > 0;

-- ──────────────────────────────────────────────────────────────────────────────
-- 2. claim_run_request: attempt_count'u artır
-- ──────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION claim_run_request()
RETURNS run_requests
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_row run_requests;
BEGIN
  WITH cte AS (
    SELECT id
    FROM run_requests
    WHERE status = 'pending'
    ORDER BY created_at ASC
    FOR UPDATE SKIP LOCKED
    LIMIT 1
  )
  UPDATE run_requests r
  SET status        = 'running',
      started_at    = now(),
      updated_at    = now(),
      attempt_count = attempt_count + 1
  FROM cte
  WHERE r.id = cte.id
  RETURNING r.* INTO v_row;

  RETURN v_row;
END;
$$;

-- ──────────────────────────────────────────────────────────────────────────────
-- 3. cleanup_stale_running_jobs: Ölü worker'dan kalan job'ları temizle
--    stale_minutes: kaç dakika 'running' kalan job "ölü" sayılır (varsayılan 35)
--    max_attempts:  bu kadar deneme sonrası kalıcı fail olur (varsayılan 3)
-- ──────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.cleanup_stale_running_jobs(
  stale_minutes INTEGER DEFAULT 35,
  max_attempts  INTEGER DEFAULT 3
)
RETURNS TABLE(job_id UUID, new_status TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  UPDATE run_requests
  SET status        = CASE
                        WHEN attempt_count >= max_attempts THEN 'fail'
                        ELSE 'pending'
                      END,
      started_at    = CASE WHEN attempt_count < max_attempts THEN NULL ELSE started_at END,
      updated_at    = now(),
      error_message = CASE
                        WHEN attempt_count >= max_attempts
                          THEN 'Max deneme sayısına ulaşıldı (' || attempt_count || '); stale timeout.'
                        ELSE 'Worker stale timeout — yeniden kuyruğa alındı (deneme ' || attempt_count || ')'
                      END
  WHERE status    = 'running'
    AND started_at < now() - (stale_minutes || ' minutes')::INTERVAL
  RETURNING id, status;
END;
$$;

REVOKE ALL ON FUNCTION public.cleanup_stale_running_jobs FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cleanup_stale_running_jobs TO service_role;

-- ──────────────────────────────────────────────────────────────────────────────
-- 4. sla_breach indeksi — Dashboard KPI'lar için
-- ──────────────────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_run_requests_sla_breach
  ON run_requests(owner_user_id, created_at DESC)
  WHERE sla_breach = true;
