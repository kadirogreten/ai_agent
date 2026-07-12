-- D4b: A2A Agent Card policy seeds + canary pack a2a_public.
-- Desen: 20260611170000_policy_settings.sql, 20260710190000_d4a_mcp_registry.sql.

INSERT INTO public.policy_settings (owner_user_id, key, value, description)
SELECT NULL, 'a2a.card_enabled', 'false'::jsonb,
  'D4b — Global Agent Card yayın kapısı. false iken yalnız meta.a2a_public=true pack''ler dışa açılır.'
WHERE NOT EXISTS (
  SELECT 1 FROM public.policy_settings
  WHERE key = 'a2a.card_enabled' AND owner_user_id IS NULL
);

INSERT INTO public.policy_settings (owner_user_id, key, value, description)
SELECT NULL, 'a2a.default_pack_id', '"sosyal-medya-reklam-gelirleri"'::jsonb,
  'D4b — /.well-known/agent-card.json varsayılan pack id (query ?pack= yoksa).'
WHERE NOT EXISTS (
  SELECT 1 FROM public.policy_settings
  WHERE key = 'a2a.default_pack_id' AND owner_user_id IS NULL
);

-- Canary pack: mevcut meta korunarak a2a_public=true
UPDATE public.domain_packs
SET meta = coalesce(meta, '{}'::jsonb) || '{"a2a_public": true}'::jsonb,
    updated_at = now()
WHERE id = 'sosyal-medya-reklam-gelirleri'
  AND status = 'active';
