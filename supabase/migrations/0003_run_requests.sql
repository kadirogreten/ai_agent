CREATE TABLE IF NOT EXISTS run_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id UUID NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','running','success','fail','cancelled')),
  mode TEXT NOT NULL DEFAULT 'ceo' CHECK (mode IN ('run','bundle','ceo','ceo-iterate')),
  domain_pack TEXT,
  request_text TEXT,
  answers_json JSONB,
  model TEXT,
  web BOOLEAN NOT NULL DEFAULT true,
  contrarian BOOLEAN NOT NULL DEFAULT false,
  risk TEXT NOT NULL DEFAULT 'R1' CHECK (risk IN ('R0','R1','R2','R3')),
  allow_high_risk BOOLEAN NOT NULL DEFAULT false,
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  error_message TEXT,
  result_json JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_run_requests_owner_created_at ON run_requests(owner_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_run_requests_status_created_at ON run_requests(status, created_at DESC);

ALTER TABLE run_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY run_requests_select_own ON run_requests
  FOR SELECT TO authenticated
  USING (owner_user_id = auth.uid());

CREATE POLICY run_requests_insert_own ON run_requests
  FOR INSERT TO authenticated
  WITH CHECK (owner_user_id = auth.uid());

CREATE POLICY run_requests_update_own ON run_requests
  FOR UPDATE TO authenticated
  USING (owner_user_id = auth.uid())
  WITH CHECK (owner_user_id = auth.uid());

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
  SET status = 'running',
      started_at = now(),
      updated_at = now()
  FROM cte
  WHERE r.id = cte.id
  RETURNING r.* INTO v_row;

  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION claim_run_request() FROM PUBLIC;

