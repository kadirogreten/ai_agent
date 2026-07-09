-- PR-D1a: Adım-bazlı model router — basic tier seed + upgrade policy.
-- Idempotent; RLS deseni değişmez.

INSERT INTO public.llm_providers (slug, display_name, api_base, api_key_env, model_id, kind, tier, max_decision_risk, enabled, is_default_for)
SELECT 'gpt-4.1-mini-basic', 'GPT-4.1 Mini (Basic)', 'https://api.openai.com', 'OPENAI_API_KEY',
  'gpt-4.1-mini', 'openai', 'basic', 'R1', true, ARRAY[]::TEXT[]
WHERE NOT EXISTS (SELECT 1 FROM public.llm_providers WHERE slug = 'gpt-4.1-mini-basic');

INSERT INTO public.policy_settings (owner_user_id, key, value, description)
SELECT NULL, 'router.verifier_fail_upgrade', 'true'::jsonb,
  'Verifier FAIL sonrası frontier model ile bir kez yeniden dene (yan etki koruması Orchestrator''da).'
WHERE NOT EXISTS (
  SELECT 1 FROM public.policy_settings
  WHERE key = 'router.verifier_fail_upgrade' AND owner_user_id IS NULL
);

INSERT INTO public.policy_settings (owner_user_id, key, value, description)
SELECT NULL, 'router.max_upgrade_per_run', '1'::jsonb,
  'Run başına maksimum model upgrade-retry sayısı.'
WHERE NOT EXISTS (
  SELECT 1 FROM public.policy_settings
  WHERE key = 'router.max_upgrade_per_run' AND owner_user_id IS NULL
);

NOTIFY pgrst, 'reload schema';
