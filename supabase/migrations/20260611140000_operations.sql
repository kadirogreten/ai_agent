-- PR3: İzle-ve-devam-et operasyon döngüsü — şema.
-- operations: hedef + sınırlar + durum.
-- operation_events: her observe/decide/act/escalate adımı loglanır.
-- run_requests.operation_id: tick'in tetiklediği run'ı operasyona bağlar.
--
-- Adlandırma: tarih-damgalı düzen (20260609* gibi).
-- RLS deseni: 004_approval_queue.sql + 20260609120000_tedarik_stock_levels.sql izlendi.

-- ── operations ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.operations (
  id                 UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id      UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  goal_text          TEXT        NOT NULL,
  domain_pack        TEXT        NOT NULL,
  persona            TEXT,
  model              TEXT,
  risk               TEXT        NOT NULL DEFAULT 'R1'
                                 CHECK (risk IN ('R0','R1','R2','R3')),
  status             TEXT        NOT NULL DEFAULT 'active'
                                 CHECK (status IN ('active','paused','escalated','done','failed')),
  max_steps          INT         NOT NULL DEFAULT 10,
  step_count         INT         NOT NULL DEFAULT 0,
  cooldown_minutes   INT         NOT NULL DEFAULT 30,
  -- last_tick_at: optimistic claim için kullanılır (UPDATE WHERE last_tick_at = eski değer).
  -- Birden fazla tick aynı satırı seçse bile yalnız biri kazanır.
  last_tick_at       TIMESTAMPTZ,
  escalation_reason  TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.operations IS
  'Kapalı döngü operasyonları. Her tick observe→decide→act zinciri işler. '
  'step_count >= max_steps durumu SELECT filtresi DEĞİL, tick kodu tarafından '
  'kontrol edilip escalate edilir — aksi halde kayıt hiç seçilmez ve escalate asla çalışmaz.';

COMMENT ON COLUMN public.operations.last_tick_at IS
  'Optimistic claim için: UPDATE ... WHERE last_tick_at = <okunan değer>. '
  'Etkilenen satır 0 ise başka tick almıştır; bu tick atlar.';

ALTER TABLE public.operations ENABLE ROW LEVEL SECURITY;

CREATE POLICY op_select_own ON public.operations
  FOR SELECT TO authenticated
  USING (owner_user_id = auth.uid());

CREATE POLICY op_insert_own ON public.operations
  FOR INSERT TO authenticated
  WITH CHECK (owner_user_id = auth.uid());

CREATE POLICY op_update_own ON public.operations
  FOR UPDATE TO authenticated
  USING (owner_user_id = auth.uid())
  WITH CHECK (owner_user_id = auth.uid());

CREATE POLICY op_service_role_all ON public.operations
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);

GRANT SELECT, INSERT, UPDATE ON TABLE public.operations TO authenticated;
GRANT ALL ON TABLE public.operations TO service_role;

CREATE INDEX IF NOT EXISTS idx_op_owner_status
  ON public.operations(owner_user_id, status)
  WHERE status = 'active';

CREATE INDEX IF NOT EXISTS idx_op_tick
  ON public.operations(status, last_tick_at NULLS FIRST)
  WHERE status = 'active';

-- ── operation_events ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.operation_events (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  operation_id UUID        NOT NULL REFERENCES public.operations(id) ON DELETE CASCADE,
  kind         TEXT        NOT NULL CHECK (kind IN ('observe','decide','act','escalate')),
  payload      JSONB       NOT NULL DEFAULT '{}',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.operation_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY oe_select_own ON public.operation_events
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.operations o
      WHERE o.id = operation_id AND o.owner_user_id = auth.uid()
    )
  );

CREATE POLICY oe_service_role_all ON public.operation_events
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);

GRANT SELECT ON TABLE public.operation_events TO authenticated;
GRANT ALL ON TABLE public.operation_events TO service_role;

CREATE INDEX IF NOT EXISTS idx_oe_operation_created
  ON public.operation_events(operation_id, created_at DESC);

-- ── run_requests.operation_id ────────────────────────────────────────────────
-- Tick'in tetiklediği run_request'i operasyona bağlar.
-- İndeks: OBSERVE sorgusunda "bu operasyonun son run'ı nedir?" için kritik.
ALTER TABLE public.run_requests
  ADD COLUMN IF NOT EXISTS operation_id UUID REFERENCES public.operations(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_rr_operation_id
  ON public.run_requests(operation_id, created_at DESC)
  WHERE operation_id IS NOT NULL;

COMMENT ON COLUMN public.run_requests.operation_id IS
  'NULL = manuel/zamanlayıcı tetikli. Dolu = operasyon döngüsü tetikli.';
