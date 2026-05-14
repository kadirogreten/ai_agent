-- IP1.5: Approval Queue — R2/R3 adımlarda insan onay kapısı
-- Strateji §6.5: "Approval Queue: R2/R3 adımlarda insan onayını bekler, onay alana kadar çalışmayı durdurur"
-- Strateji §4.4: "R2/R3 zorunlu insan onay kapısı; otomatik bypass mümkün değil"

CREATE TABLE IF NOT EXISTS approval_queue (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id   UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  run_request_id  UUID REFERENCES run_requests(id) ON DELETE CASCADE,
  run_id          UUID REFERENCES runs(id) ON DELETE SET NULL,

  -- Hangi adım onay bekliyor
  step_index      INTEGER NOT NULL DEFAULT 0,
  step_name       TEXT,
  agent_code      TEXT,

  -- Risk ve içerik
  risk_level      TEXT NOT NULL CHECK (risk_level IN ('R2','R3')),
  action_summary  TEXT NOT NULL,   -- "Ne yapmak istiyor" — kısa özet
  action_detail   JSONB,           -- tam parametre seti

  -- Onay durumu
  status          TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','approved','rejected','expired')),
  reviewer_id     UUID REFERENCES auth.users(id),
  reviewer_note   TEXT,
  decided_at      TIMESTAMPTZ,

  -- Zaman
  expires_at      TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '24 hours'),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- RLS
ALTER TABLE approval_queue ENABLE ROW LEVEL SECURITY;

-- Kullanıcı kendi kuyruğunu görür
CREATE POLICY aq_select ON approval_queue
  FOR SELECT USING (owner_user_id = auth.uid());

-- Worker (service_role) ekleyebilir
CREATE POLICY aq_insert ON approval_queue
  FOR INSERT TO service_role
  WITH CHECK (true);

-- Kullanıcı onaylayabilir/reddedebilir (kendi kayıtları)
CREATE POLICY aq_update ON approval_queue
  FOR UPDATE TO authenticated
  USING (owner_user_id = auth.uid())
  WITH CHECK (owner_user_id = auth.uid());

-- Service role tam erişim
CREATE POLICY aq_service_role_all ON approval_queue
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

-- İndeksler
CREATE INDEX IF NOT EXISTS idx_aq_owner_status    ON approval_queue(owner_user_id, status);
CREATE INDEX IF NOT EXISTS idx_aq_run_request     ON approval_queue(run_request_id);
CREATE INDEX IF NOT EXISTS idx_aq_pending_expires ON approval_queue(expires_at) WHERE status = 'pending';

-- updated_at otomatik güncelle
CREATE OR REPLACE FUNCTION update_approval_queue_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_aq_updated_at ON approval_queue;
CREATE TRIGGER trg_aq_updated_at
  BEFORE UPDATE ON approval_queue
  FOR EACH ROW EXECUTE FUNCTION update_approval_queue_updated_at();
