-- D4d: Usage metering views + billing policy seeds (görünürlük; ödeme değil).
-- Eval koşumları faturalama özetinden dışlanır (D1b KPI disiplini).

CREATE OR REPLACE VIEW public.usage_monthly
WITH (security_invoker = true)
AS
SELECT
  owner_user_id,
  date_trunc('month', created_at)::date AS period_month,
  domain_pack,
  count(*)                   AS run_count,
  coalesce(sum(cost_usd), 0) AS llm_cost_usd,
  coalesce(sum(tokens_in), 0)  AS tokens_in,
  coalesce(sum(tokens_out), 0) AS tokens_out
FROM public.runs
WHERE (meta->>'eval') IS DISTINCT FROM 'true'
GROUP BY owner_user_id, date_trunc('month', created_at), domain_pack;

COMMENT ON VIEW public.usage_monthly IS
  'D4d — Aylık LLM kullanımı (owner×pack). meta.eval=true koşumları dışlanır.';

CREATE OR REPLACE VIEW public.ad_spend_monthly
WITH (security_invoker = true)
AS
SELECT
  owner_user_id,
  date_trunc('month', created_at)::date AS period_month,
  platform,
  currency,
  coalesce(sum(spent), 0) AS spent,
  count(*)                AS campaign_count
FROM public.ad_spend_ledger
GROUP BY owner_user_id, date_trunc('month', created_at), platform, currency;

COMMENT ON VIEW public.ad_spend_monthly IS
  'D4d — Aylık reklam harcaması (platform×currency). LLM maliyetiyle toplanmaz.';

GRANT SELECT ON public.usage_monthly TO authenticated, service_role;
GRANT SELECT ON public.ad_spend_monthly TO authenticated, service_role;

INSERT INTO public.policy_settings (owner_user_id, key, value, description)
SELECT NULL, 'billing.monthly_llm_budget_usd', 'null'::jsonb,
  'D4d — Aylık LLM bütçesi (USD). null = limitsiz. Soft UI uyarısı; hard cap yok.'
WHERE NOT EXISTS (
  SELECT 1 FROM public.policy_settings
  WHERE key = 'billing.monthly_llm_budget_usd' AND owner_user_id IS NULL
);

INSERT INTO public.policy_settings (owner_user_id, key, value, description)
SELECT NULL, 'billing.alert_threshold_pct', '80'::jsonb,
  'D4d — Bütçe uyarı eşiği (%). UI amber bandı; soft only.'
WHERE NOT EXISTS (
  SELECT 1 FROM public.policy_settings
  WHERE key = 'billing.alert_threshold_pct' AND owner_user_id IS NULL
);
