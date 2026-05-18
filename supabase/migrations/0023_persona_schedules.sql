-- 0023_persona_schedules.sql
-- Kapı 3: Çok-Günlü Otonomi — persona'lar için zamanlanmış çalıştırma.
-- Bir persona + playbook + topic eşleşmesi cron ifadesine göre tetiklenir,
-- scheduler worker tarafından run_requests'e otomatik insert edilir.

CREATE TABLE IF NOT EXISTS public.persona_schedules (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id   UUID        NOT NULL,
  tenant_id       UUID,                                  -- NULL = sistem geneli
  name            TEXT        NOT NULL,                  -- "Sabah pazar brief"
  description     TEXT,
  domain_pack     TEXT        NOT NULL,
  persona_slug    TEXT        NOT NULL,
  playbook_slug   TEXT        NOT NULL,
  topic_template  TEXT        NOT NULL,                  -- "{{date}} için günlük brief" gibi
  cron_expression TEXT        NOT NULL,                  -- "0 8 * * *" (her gün 08:00)
  timezone        TEXT        NOT NULL DEFAULT 'Europe/Istanbul',
  model           TEXT,                                  -- override (NULL = sistem default)
  risk            TEXT        NOT NULL DEFAULT 'R1'
                              CHECK (risk IN ('R0','R1','R2','R3')),
  allow_high_risk BOOLEAN     NOT NULL DEFAULT false,
  web             BOOLEAN     NOT NULL DEFAULT true,
  contrarian      BOOLEAN     NOT NULL DEFAULT false,
  enabled         BOOLEAN     NOT NULL DEFAULT true,
  last_fired_at   TIMESTAMPTZ,
  next_fire_at    TIMESTAMPTZ,                           -- scheduler hesaplar
  last_run_id     UUID,                                  -- son tetiklediği run_request.id
  consecutive_failures INTEGER NOT NULL DEFAULT 0,        -- anomali tetiği için
  anomaly_threshold    INTEGER NOT NULL DEFAULT 3,        -- 3 başarısız → otomatik disable
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_schedules_owner       ON public.persona_schedules(owner_user_id);
CREATE INDEX IF NOT EXISTS idx_schedules_enabled_next ON public.persona_schedules(enabled, next_fire_at)
  WHERE enabled = true;

ALTER TABLE public.persona_schedules ENABLE ROW LEVEL SECURITY;

CREATE POLICY persona_schedules_select_own ON public.persona_schedules
  FOR SELECT TO authenticated
  USING (owner_user_id = auth.uid());

CREATE POLICY persona_schedules_insert_own ON public.persona_schedules
  FOR INSERT TO authenticated
  WITH CHECK (owner_user_id = auth.uid());

CREATE POLICY persona_schedules_update_own ON public.persona_schedules
  FOR UPDATE TO authenticated
  USING (owner_user_id = auth.uid())
  WITH CHECK (owner_user_id = auth.uid());

CREATE POLICY persona_schedules_delete_own ON public.persona_schedules
  FOR DELETE TO authenticated
  USING (owner_user_id = auth.uid());

CREATE POLICY persona_schedules_service_all ON public.persona_schedules
  FOR ALL USING (auth.role() = 'service_role');

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.persona_schedules TO authenticated;

-- Scheduler tick'inden çağrılır: vadesi gelmiş ve enabled olan schedule'ları döner.
-- Scheduler her birini bir run_request'e çevirir, last_fired_at + next_fire_at günceller.
CREATE OR REPLACE FUNCTION public.list_due_schedules(p_now TIMESTAMPTZ DEFAULT now())
RETURNS SETOF persona_schedules
LANGUAGE sql
SECURITY DEFINER
AS $$
  SELECT *
  FROM public.persona_schedules
  WHERE enabled = true
    AND (next_fire_at IS NULL OR next_fire_at <= p_now)
    AND consecutive_failures < anomaly_threshold
  ORDER BY next_fire_at NULLS FIRST
  LIMIT 50;
$$;

GRANT EXECUTE ON FUNCTION public.list_due_schedules(TIMESTAMPTZ) TO service_role;
