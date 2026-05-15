-- 0021_run_outputs.sql
-- Tam DB-first: run çıktıları, event log, CEO plan/execution ve global facts artık DB'de.
-- Disk yazımı tamamen kaldırıldı.

-- ── run_outputs ─────────────────────────────────────────────────────────────
-- Her playbook adımının ve artifact'ın metinsel çıktısı
CREATE TABLE IF NOT EXISTS public.run_outputs (
    id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    run_id        TEXT        NOT NULL,
    step_id       TEXT,
    agent_id      TEXT,
    artifact_name TEXT,
    output_type   TEXT        NOT NULL DEFAULT 'step',
    -- step | artifact | report | facts | decisions | work | image_ref | bundle_manifest | revised
    content_md    TEXT,
    content_json  JSONB,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS run_outputs_run_id_idx ON public.run_outputs (run_id);

-- ── run_events ──────────────────────────────────────────────────────────────
-- Event log (eskiden log.jsonl): step_start, step_end, run_metrics, facts_extract, ...
CREATE TABLE IF NOT EXISTS public.run_events (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    run_id      TEXT        NOT NULL,
    event_type  TEXT        NOT NULL,
    payload     JSONB,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS run_events_run_id_idx ON public.run_events (run_id);

-- ── ceo_plans ───────────────────────────────────────────────────────────────
-- CEO planlama çıktısı (eskiden plan.json + questions.md)
CREATE TABLE IF NOT EXISTS public.ceo_plans (
    id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    domain_pack           TEXT        NOT NULL,
    request_text          TEXT,
    answers_json          JSONB,
    primary_topic         TEXT,
    subtopics             JSONB,
    rationale             TEXT,
    clarifying_questions  JSONB,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── ceo_executions ──────────────────────────────────────────────────────────
-- CEO çalıştırma özeti (eskiden ceo.json + execution.json)
CREATE TABLE IF NOT EXISTS public.ceo_executions (
    id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    ceo_plan_id  UUID        REFERENCES public.ceo_plans (id),
    domain_pack  TEXT,
    model        TEXT,
    dry_run      BOOLEAN     NOT NULL DEFAULT false,
    succeeded    INT         NOT NULL DEFAULT 0,
    failed       INT         NOT NULL DEFAULT 0,
    runs         JSONB,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── facts ───────────────────────────────────────────────────────────────────
-- Global facts store (eskiden knowledge/{pack}/facts.jsonl)
CREATE TABLE IF NOT EXISTS public.facts (
    id              TEXT        PRIMARY KEY,
    domain_pack     TEXT        NOT NULL,
    run_id          TEXT,
    playbook_id     TEXT,
    topic           TEXT,
    claim           TEXT        NOT NULL,
    evidence_url    TEXT,
    evidence_quote  TEXT,
    source_title    TEXT,
    source_domain   TEXT,
    confidence      FLOAT,
    extracted_at    TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS facts_domain_pack_idx ON public.facts (domain_pack);
CREATE INDEX IF NOT EXISTS facts_run_id_idx      ON public.facts (run_id);

-- ── RLS ─────────────────────────────────────────────────────────────────────
-- Service role key RLS'i zaten bypass eder.
-- Anon/authenticated erişimi kapalı (policy yok = erişim yok).
ALTER TABLE public.run_outputs    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.run_events     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ceo_plans      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ceo_executions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.facts          ENABLE ROW LEVEL SECURITY;
