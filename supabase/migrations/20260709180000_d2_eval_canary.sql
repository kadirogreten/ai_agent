-- D2b: eval_json + eval kapısı; D2c: canary meta + decrement RPC

ALTER TABLE domain_pack_drafts
  ADD COLUMN IF NOT EXISTS eval_json JSONB,
  ADD COLUMN IF NOT EXISTS eval_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (eval_status IN ('pending','running','passed','failed','skipped')),
  ADD COLUMN IF NOT EXISTS eval_generator_run_id UUID REFERENCES run_requests(id);

COMMENT ON COLUMN domain_pack_drafts.eval_json IS 'D2b — otomatik golden-set (pack_rubric + D0 security karışımı)';
COMMENT ON COLUMN domain_pack_drafts.eval_status IS 'Harness pass³ sonucu; merge için passed gerekir';
COMMENT ON COLUMN domain_pack_drafts.eval_generator_run_id IS 'EvalGenerator izole run_requests.id (taslak üretici ≠ eval üretici)';

-- merge_domain_pack_draft: eval kapısı + canary meta
CREATE OR REPLACE FUNCTION merge_domain_pack_draft(
    p_draft_id    UUID,
    p_reviewer_id UUID DEFAULT auth.uid()
)
RETURNS TEXT
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
    v_draft       domain_pack_drafts%ROWTYPE;
    v_pack_id     TEXT;
    v_draft_json  JSONB;
    v_playbook    JSONB;
    v_persona     JSONB;
    v_bundle      JSONB;
    v_canary_runs INT;
    v_allow_skip  BOOLEAN;
BEGIN
    SELECT * INTO v_draft
    FROM domain_pack_drafts
    WHERE id = p_draft_id AND status = 'pending'
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Draft % bulunamadı veya zaten işlendi.', p_draft_id;
    END IF;

    SELECT COALESCE((value #>> '{}')::int, 5) INTO v_canary_runs
    FROM policy_settings
    WHERE key = 'pack.canary_runs' AND owner_user_id IS NULL
    LIMIT 1;
    IF v_canary_runs IS NULL THEN v_canary_runs := 5; END IF;

    SELECT COALESCE((value #>> '{}')::boolean, false) INTO v_allow_skip
    FROM policy_settings
    WHERE key = 'factory.allow_merge_without_eval' AND owner_user_id IS NULL
    LIMIT 1;
    IF v_allow_skip IS NULL THEN v_allow_skip := false; END IF;

    IF NOT v_allow_skip AND COALESCE(v_draft.eval_status, 'pending') <> 'passed' THEN
        RAISE EXCEPTION 'Eval geçmedi (eval_status=%). Merge engellendi.', v_draft.eval_status;
    END IF;

    v_draft_json := v_draft.draft_json;
    v_pack_id    := COALESCE(v_draft.proposed_pack_id,
                             v_draft_json->>'id',
                             'pack-' || left(v_draft.id::text, 8));

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
        jsonb_build_object(
            'canary', true,
            'canary_remaining', v_canary_runs,
            'canary_risk_floor', 'R2',
            'canary_d0_verified', false,
            'merged_at', to_jsonb(now()::timestamptz)
        )
    )
    ON CONFLICT (id) DO UPDATE SET
        name        = EXCLUDED.name,
        description = EXCLUDED.description,
        status      = 'active',
        meta        = EXCLUDED.meta,
        updated_at  = now();

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

    UPDATE domain_pack_drafts SET
        status         = 'merged',
        reviewed_by    = p_reviewer_id,
        reviewed_at    = now(),
        merged_pack_id = v_pack_id
    WHERE id = p_draft_id;

    RETURN v_pack_id;
END;
$$;

-- D2c: başarılı production run sonrası canary sayacı (eval run'ları hariç)
CREATE OR REPLACE FUNCTION decrement_pack_canary(
    p_pack_id TEXT,
    p_is_eval BOOLEAN DEFAULT false
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
    v_meta JSONB;
    v_remaining INT;
    v_d0_verified BOOLEAN;
    v_canary BOOLEAN;
BEGIN
    IF p_is_eval THEN
        RETURN jsonb_build_object('skipped', true, 'reason', 'eval_run');
    END IF;

    SELECT meta INTO v_meta FROM domain_packs WHERE id = p_pack_id FOR UPDATE;
    IF NOT FOUND OR COALESCE((v_meta->>'canary')::boolean, false) = false THEN
        RETURN jsonb_build_object('skipped', true, 'reason', 'not_canary');
    END IF;

    v_remaining   := GREATEST(0, COALESCE((v_meta->>'canary_remaining')::int, 0) - 1);
    v_d0_verified := COALESCE((v_meta->>'canary_d0_verified')::boolean, false);
    v_canary      := NOT (v_remaining = 0 AND v_d0_verified);

    v_meta := v_meta
        || jsonb_build_object('canary_remaining', v_remaining)
        || jsonb_build_object('canary', v_canary);

    UPDATE domain_packs SET meta = v_meta, updated_at = now() WHERE id = p_pack_id;

    RETURN jsonb_build_object(
        'pack_id', p_pack_id,
        'canary_remaining', v_remaining,
        'canary_d0_verified', v_d0_verified,
        'canary', v_canary
    );
END;
$$;

CREATE OR REPLACE FUNCTION set_pack_canary_d0_verified(p_pack_id TEXT)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
    v_meta JSONB;
    v_remaining INT;
    v_canary BOOLEAN;
BEGIN
    SELECT meta INTO v_meta FROM domain_packs WHERE id = p_pack_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Pack % bulunamadı.', p_pack_id;
    END IF;

    v_remaining := COALESCE((v_meta->>'canary_remaining')::int, 0);
    v_meta := v_meta || jsonb_build_object('canary_d0_verified', true);
    v_canary := NOT (v_remaining = 0 AND true);

    UPDATE domain_packs
    SET meta = v_meta || jsonb_build_object('canary', v_canary),
        updated_at = now()
    WHERE id = p_pack_id;

    RETURN v_meta || jsonb_build_object('canary', v_canary);
END;
$$;

INSERT INTO public.policy_settings (owner_user_id, key, value, description)
SELECT NULL, 'factory.eval_pass_threshold', '0.8'::jsonb, 'Draft eval harness pass rate eşiği.'
WHERE NOT EXISTS (SELECT 1 FROM public.policy_settings WHERE key = 'factory.eval_pass_threshold' AND owner_user_id IS NULL);

INSERT INTO public.policy_settings (owner_user_id, key, value, description)
SELECT NULL, 'factory.eval_pass_k', '3'::jsonb, 'Draft eval pass^k deneme sayısı.'
WHERE NOT EXISTS (SELECT 1 FROM public.policy_settings WHERE key = 'factory.eval_pass_k' AND owner_user_id IS NULL);

INSERT INTO public.policy_settings (owner_user_id, key, value, description)
SELECT NULL, 'factory.allow_merge_without_eval', 'false'::jsonb, 'Eval geçmeden merge (override).'
WHERE NOT EXISTS (SELECT 1 FROM public.policy_settings WHERE key = 'factory.allow_merge_without_eval' AND owner_user_id IS NULL);

INSERT INTO public.policy_settings (owner_user_id, key, value, description)
SELECT NULL, 'pack.canary_runs', '5'::jsonb, 'Yeni merge pack canary production run sayısı.'
WHERE NOT EXISTS (SELECT 1 FROM public.policy_settings WHERE key = 'pack.canary_runs' AND owner_user_id IS NULL);

NOTIFY pgrst, 'reload schema';
