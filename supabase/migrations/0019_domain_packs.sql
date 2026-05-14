-- ============================================================
-- 0019_domain_packs.sql
-- Faz 2.5 DB-leştirme: domain packs, personas, playbooks,
-- playbook_bundles ve domain_pack_drafts tabloları
-- ============================================================

-- ── 1. domain_packs ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS domain_packs (
    id              TEXT        PRIMARY KEY,           -- "e-ticaret", "hibe-yazimi" …
    name            TEXT        NOT NULL,
    description     TEXT,
    tenant_id       UUID        REFERENCES auth.users(id) ON DELETE CASCADE,
    status          TEXT        NOT NULL DEFAULT 'active'
                                CHECK (status IN ('active','archived','draft')),
    version         INTEGER     NOT NULL DEFAULT 1,
    allowed_domains TEXT[]      NOT NULL DEFAULT '{}',
    glossary_md     TEXT,
    regulatory_notes_md TEXT,
    verifier_rubric_md  TEXT,
    meta            JSONB       NOT NULL DEFAULT '{}',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- NULL tenant_id = system/built-in (tüm tenant'lara açık)
-- Non-null tenant_id = o tenant'a özel

ALTER TABLE domain_packs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "domain_packs_select" ON domain_packs
    FOR SELECT USING (
        tenant_id IS NULL
        OR tenant_id = auth.uid()
    );

CREATE POLICY "domain_packs_insert" ON domain_packs
    FOR INSERT WITH CHECK (
        tenant_id = auth.uid()
    );

CREATE POLICY "domain_packs_update" ON domain_packs
    FOR UPDATE USING (
        tenant_id = auth.uid()
    );

CREATE POLICY "domain_packs_delete" ON domain_packs
    FOR DELETE USING (
        tenant_id = auth.uid()
    );

-- Service role için kısıtlama yok (sync script kullanır)
CREATE POLICY "domain_packs_service_all" ON domain_packs
    FOR ALL USING (auth.role() = 'service_role');

-- ── 2. personas ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS personas (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    slug            TEXT        NOT NULL,              -- "merchandiser", "hibe-yazari"
    pack_id         TEXT        REFERENCES domain_packs(id) ON DELETE CASCADE,
                                                       -- NULL = cross-domain persona
    tenant_id       UUID        REFERENCES auth.users(id) ON DELETE CASCADE,
    name            TEXT        NOT NULL,
    role_description TEXT,
    system_prompt   TEXT,
    behaviors       JSONB       NOT NULL DEFAULT '{}',
    risk_ceiling    TEXT        NOT NULL DEFAULT 'R2'
                                CHECK (risk_ceiling IN ('R0','R1','R2','R3')),
    cost_class      TEXT        NOT NULL DEFAULT 'medium'
                                CHECK (cost_class IN ('low','medium','high')),
    content_md      TEXT,                              -- tam personas/*.md içeriği
    meta            JSONB       NOT NULL DEFAULT '{}',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (slug, pack_id, tenant_id)
);

ALTER TABLE personas ENABLE ROW LEVEL SECURITY;

CREATE POLICY "personas_select" ON personas
    FOR SELECT USING (
        tenant_id IS NULL
        OR tenant_id = auth.uid()
    );

CREATE POLICY "personas_insert" ON personas
    FOR INSERT WITH CHECK (tenant_id = auth.uid());

CREATE POLICY "personas_update" ON personas
    FOR UPDATE USING (tenant_id = auth.uid());

CREATE POLICY "personas_delete" ON personas
    FOR DELETE USING (tenant_id = auth.uid());

CREATE POLICY "personas_service_all" ON personas
    FOR ALL USING (auth.role() = 'service_role');

-- ── 3. playbooks ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS playbooks (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    slug            TEXT        NOT NULL,              -- "urun-aciklama-uret"
    pack_id         TEXT        NOT NULL REFERENCES domain_packs(id) ON DELETE CASCADE,
    tenant_id       UUID        REFERENCES auth.users(id) ON DELETE CASCADE,
    name            TEXT        NOT NULL,
    description     TEXT,
    goal            TEXT,
    steps           JSONB       NOT NULL DEFAULT '[]', -- [{agent, prompt_template, …}]
    default_risk    TEXT        NOT NULL DEFAULT 'R1'
                                CHECK (default_risk IN ('R0','R1','R2','R3')),
    required_tools  TEXT[]      NOT NULL DEFAULT '{}',
    tags            TEXT[]      NOT NULL DEFAULT '{}',
    content_json    JSONB,                             -- raw playbook JSON dosyası
    version         INTEGER     NOT NULL DEFAULT 1,
    meta            JSONB       NOT NULL DEFAULT '{}',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (slug, pack_id, tenant_id)
);

ALTER TABLE playbooks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "playbooks_select" ON playbooks
    FOR SELECT USING (
        tenant_id IS NULL
        OR tenant_id = auth.uid()
    );

CREATE POLICY "playbooks_insert" ON playbooks
    FOR INSERT WITH CHECK (tenant_id = auth.uid());

CREATE POLICY "playbooks_update" ON playbooks
    FOR UPDATE USING (tenant_id = auth.uid());

CREATE POLICY "playbooks_delete" ON playbooks
    FOR DELETE USING (tenant_id = auth.uid());

CREATE POLICY "playbooks_service_all" ON playbooks
    FOR ALL USING (auth.role() = 'service_role');

-- ── 4. playbook_bundles ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS playbook_bundles (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    slug            TEXT        NOT NULL,              -- "tubitak-1507-tam-paket"
    pack_id         TEXT        NOT NULL REFERENCES domain_packs(id) ON DELETE CASCADE,
    tenant_id       UUID        REFERENCES auth.users(id) ON DELETE CASCADE,
    name            TEXT        NOT NULL,
    description     TEXT,
    playbook_slugs  TEXT[]      NOT NULL DEFAULT '{}', -- sıralı playbook slug listesi
    default_risk    TEXT        NOT NULL DEFAULT 'R1'
                                CHECK (default_risk IN ('R0','R1','R2','R3')),
    content_json    JSONB,                             -- raw bundle JSON
    version         INTEGER     NOT NULL DEFAULT 1,
    meta            JSONB       NOT NULL DEFAULT '{}',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (slug, pack_id, tenant_id)
);

ALTER TABLE playbook_bundles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "playbook_bundles_select" ON playbook_bundles
    FOR SELECT USING (
        tenant_id IS NULL
        OR tenant_id = auth.uid()
    );

CREATE POLICY "playbook_bundles_insert" ON playbook_bundles
    FOR INSERT WITH CHECK (tenant_id = auth.uid());

CREATE POLICY "playbook_bundles_update" ON playbook_bundles
    FOR UPDATE USING (tenant_id = auth.uid());

CREATE POLICY "playbook_bundles_delete" ON playbook_bundles
    FOR DELETE USING (tenant_id = auth.uid());

CREATE POLICY "playbook_bundles_service_all" ON playbook_bundles
    FOR ALL USING (auth.role() = 'service_role');

-- ── 5. domain_pack_drafts ─────────────────────────────────────
-- Sector Discovery Agent'ın ürettiği taslak domain pack'ler
-- (henüz onaylanmamış / aktif edilmemiş)
CREATE TABLE IF NOT EXISTS domain_pack_drafts (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    run_request_id  UUID        REFERENCES run_requests(id) ON DELETE SET NULL,
    sector_prompt   TEXT        NOT NULL,   -- kullanıcının girdiği sektör açıklaması
    proposed_pack_id TEXT,                  -- önerilen slug ("fintech-kredi-skorlama")
    proposed_name   TEXT,
    status          TEXT        NOT NULL DEFAULT 'pending'
                                CHECK (status IN ('pending','approved','rejected','merged')),
    draft_json      JSONB       NOT NULL DEFAULT '{}',  -- tüm taslak içerik (pack+playbooks+personas)
    review_notes    TEXT,                  -- onaylayan/reddeden notları
    reviewed_by     UUID        REFERENCES auth.users(id),
    reviewed_at     TIMESTAMPTZ,
    merged_pack_id  TEXT        REFERENCES domain_packs(id) ON DELETE SET NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE domain_pack_drafts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "drafts_select" ON domain_pack_drafts
    FOR SELECT USING (tenant_id = auth.uid());

CREATE POLICY "drafts_insert" ON domain_pack_drafts
    FOR INSERT WITH CHECK (tenant_id = auth.uid());

CREATE POLICY "drafts_update" ON domain_pack_drafts
    FOR UPDATE USING (tenant_id = auth.uid());

CREATE POLICY "drafts_delete" ON domain_pack_drafts
    FOR DELETE USING (tenant_id = auth.uid());

CREATE POLICY "drafts_service_all" ON domain_pack_drafts
    FOR ALL USING (auth.role() = 'service_role');

-- ── 6. Indeksler ──────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_domain_packs_tenant  ON domain_packs(tenant_id);
CREATE INDEX IF NOT EXISTS idx_domain_packs_status  ON domain_packs(status);
CREATE INDEX IF NOT EXISTS idx_personas_pack        ON personas(pack_id);
CREATE INDEX IF NOT EXISTS idx_personas_tenant      ON personas(tenant_id);
CREATE INDEX IF NOT EXISTS idx_playbooks_pack       ON playbooks(pack_id);
CREATE INDEX IF NOT EXISTS idx_playbooks_tenant     ON playbooks(tenant_id);
CREATE INDEX IF NOT EXISTS idx_bundles_pack         ON playbook_bundles(pack_id);
CREATE INDEX IF NOT EXISTS idx_drafts_tenant        ON domain_pack_drafts(tenant_id);
CREATE INDEX IF NOT EXISTS idx_drafts_status        ON domain_pack_drafts(status);
CREATE INDEX IF NOT EXISTS idx_drafts_run           ON domain_pack_drafts(run_request_id);

-- ── 7. updated_at otomatik güncelleme ────────────────────────
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$;

DO $$
DECLARE
    t TEXT;
BEGIN
    FOREACH t IN ARRAY ARRAY['domain_packs','personas','playbooks','playbook_bundles','domain_pack_drafts']
    LOOP
        EXECUTE format(
            'DROP TRIGGER IF EXISTS trg_%1$s_updated_at ON %1$s;
             CREATE TRIGGER trg_%1$s_updated_at
             BEFORE UPDATE ON %1$s
             FOR EACH ROW EXECUTE FUNCTION set_updated_at();',
            t
        );
    END LOOP;
END;
$$;

-- ── 8. draft → domain_pack merge RPC ─────────────────────────
CREATE OR REPLACE FUNCTION merge_domain_pack_draft(
    p_draft_id    UUID,
    p_reviewer_id UUID DEFAULT auth.uid()
)
RETURNS TEXT   -- döndürülen pack_id
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
    v_draft       domain_pack_drafts%ROWTYPE;
    v_pack_id     TEXT;
    v_draft_json  JSONB;
    v_playbook    JSONB;
    v_persona     JSONB;
    v_bundle      JSONB;
BEGIN
    -- Draft'ı kilitle
    SELECT * INTO v_draft
    FROM domain_pack_drafts
    WHERE id = p_draft_id AND status = 'pending'
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Draft % bulunamadı veya zaten işlendi.', p_draft_id;
    END IF;

    v_draft_json := v_draft.draft_json;
    v_pack_id    := COALESCE(v_draft.proposed_pack_id,
                             v_draft_json->>'id',
                             'pack-' || left(v_draft.id::text, 8));

    -- domain_pack upsert
    INSERT INTO domain_packs (
        id, name, description, tenant_id, status,
        allowed_domains, glossary_md, regulatory_notes_md,
        verifier_rubric_md, meta
    ) VALUES (
        v_pack_id,
        COALESCE(v_draft.proposed_name, v_draft_json->>'name', v_pack_id),
        v_draft_json->>'description',
        v_draft.tenant_id,
        'active',
        COALESCE(ARRAY(SELECT jsonb_array_elements_text(v_draft_json->'allowed_domains')), '{}'),
        v_draft_json->>'glossary_md',
        v_draft_json->>'regulatory_notes_md',
        v_draft_json->>'verifier_rubric_md',
        '{}'
    )
    ON CONFLICT (id) DO UPDATE SET
        name        = EXCLUDED.name,
        description = EXCLUDED.description,
        status      = 'active',
        updated_at  = now();

    -- Playbooks
    IF jsonb_typeof(v_draft_json->'playbooks') = 'array' THEN
        FOR v_playbook IN SELECT * FROM jsonb_array_elements(v_draft_json->'playbooks')
        LOOP
            INSERT INTO playbooks (
                slug, pack_id, tenant_id, name, description,
                goal, steps, default_risk, required_tools, tags, content_json
            ) VALUES (
                v_playbook->>'slug',
                v_pack_id,
                v_draft.tenant_id,
                COALESCE(v_playbook->>'name', v_playbook->>'slug'),
                v_playbook->>'description',
                v_playbook->>'goal',
                COALESCE(v_playbook->'steps', '[]'),
                COALESCE(v_playbook->>'default_risk', 'R1'),
                COALESCE(ARRAY(SELECT jsonb_array_elements_text(v_playbook->'required_tools')), '{}'),
                COALESCE(ARRAY(SELECT jsonb_array_elements_text(v_playbook->'tags')), '{}'),
                v_playbook
            )
            ON CONFLICT (slug, pack_id, tenant_id) DO UPDATE SET
                name         = EXCLUDED.name,
                description  = EXCLUDED.description,
                goal         = EXCLUDED.goal,
                steps        = EXCLUDED.steps,
                default_risk = EXCLUDED.default_risk,
                content_json = EXCLUDED.content_json,
                updated_at   = now();
        END LOOP;
    END IF;

    -- Personas
    IF jsonb_typeof(v_draft_json->'personas') = 'array' THEN
        FOR v_persona IN SELECT * FROM jsonb_array_elements(v_draft_json->'personas')
        LOOP
            INSERT INTO personas (
                slug, pack_id, tenant_id, name, role_description,
                system_prompt, behaviors, risk_ceiling, cost_class, content_md
            ) VALUES (
                v_persona->>'slug',
                v_pack_id,
                v_draft.tenant_id,
                COALESCE(v_persona->>'name', v_persona->>'slug'),
                v_persona->>'role_description',
                v_persona->>'system_prompt',
                COALESCE(v_persona->'behaviors', '{}'),
                COALESCE(v_persona->>'risk_ceiling', 'R2'),
                COALESCE(v_persona->>'cost_class', 'medium'),
                v_persona->>'content_md'
            )
            ON CONFLICT (slug, pack_id, tenant_id) DO UPDATE SET
                name             = EXCLUDED.name,
                role_description = EXCLUDED.role_description,
                system_prompt    = EXCLUDED.system_prompt,
                behaviors        = EXCLUDED.behaviors,
                content_md       = EXCLUDED.content_md,
                updated_at       = now();
        END LOOP;
    END IF;

    -- Bundles
    IF jsonb_typeof(v_draft_json->'bundles') = 'array' THEN
        FOR v_bundle IN SELECT * FROM jsonb_array_elements(v_draft_json->'bundles')
        LOOP
            INSERT INTO playbook_bundles (
                slug, pack_id, tenant_id, name, description,
                playbook_slugs, default_risk, content_json
            ) VALUES (
                v_bundle->>'slug',
                v_pack_id,
                v_draft.tenant_id,
                COALESCE(v_bundle->>'name', v_bundle->>'slug'),
                v_bundle->>'description',
                COALESCE(ARRAY(SELECT jsonb_array_elements_text(v_bundle->'playbook_slugs')), '{}'),
                COALESCE(v_bundle->>'default_risk', 'R1'),
                v_bundle
            )
            ON CONFLICT (slug, pack_id, tenant_id) DO UPDATE SET
                name           = EXCLUDED.name,
                description    = EXCLUDED.description,
                playbook_slugs = EXCLUDED.playbook_slugs,
                default_risk   = EXCLUDED.default_risk,
                content_json   = EXCLUDED.content_json,
                updated_at     = now();
        END LOOP;
    END IF;

    -- Draft'ı 'merged' olarak işaretle
    UPDATE domain_pack_drafts SET
        status         = 'merged',
        reviewed_by    = p_reviewer_id,
        reviewed_at    = now(),
        merged_pack_id = v_pack_id
    WHERE id = p_draft_id;

    RETURN v_pack_id;
END;
$$;

-- ── 9. reject_domain_pack_draft RPC ──────────────────────────
CREATE OR REPLACE FUNCTION reject_domain_pack_draft(
    p_draft_id    UUID,
    p_notes       TEXT DEFAULT NULL,
    p_reviewer_id UUID DEFAULT auth.uid()
)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
    UPDATE domain_pack_drafts SET
        status      = 'rejected',
        review_notes = p_notes,
        reviewed_by  = p_reviewer_id,
        reviewed_at  = now()
    WHERE id = p_draft_id
      AND tenant_id = auth.uid()
      AND status    = 'pending';

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Draft % bulunamadı veya zaten işlendi.', p_draft_id;
    END IF;
END;
$$;
