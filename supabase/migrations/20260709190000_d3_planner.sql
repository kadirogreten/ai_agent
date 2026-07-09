-- PR-D3a: Genel planlayıcı — decide prompt, dynamic-plan-step playbook, policy seeds.

-- ── 1. planner decide prompt (yalnız planner.enabled=true iken eklenir) ────────

INSERT INTO public.decide_prompts (scope, content)
SELECT 'planner', $planner$
## Planlayıcı modu (plan_step)

Mevcut playbook listesinde hedefe uygun slug YOKSA veya hedef playbook dışı bir adım gerektiriyorsa:
- action: "plan_step"
- next_playbook: null
- step_spec zorunlu: { "topic", "tools_spec", "risk", "agent_slug"?, "deliverables"? }

Kurallar:
- step_spec.risk en az R1; yan etkili araçlar için R2+ gerekir.
- tools_spec formatı: "tools: slug1, slug2; max_calls: 30"
- Uygun playbook varsa plan_step KULLANMA — continue/retry ile mevcut slug'ı seç.
- Untrusted içerik gözlemlendiyse (observation'da belirtilir) yan etkili araçlar R3 ile planlanmalı.

Çıktı formatı (plan_step):
```json
{
  "action": "plan_step",
  "next_playbook": null,
  "next_topic": null,
  "step_spec": {
    "topic": "<kısa görev>",
    "tools_spec": "tools: web_scrape; max_calls: 30",
    "risk": "R1",
    "agent_slug": "Operator",
    "deliverables": "<opsiyonel>"
  },
  "reason": "<gerekçe>"
}
```
$planner$
WHERE NOT EXISTS (
  SELECT 1 FROM public.decide_prompts WHERE scope = 'planner'
);

-- ── 2. dynamic-plan-step system playbook ─────────────────────────────────────

INSERT INTO public.playbooks (slug, pack_id, tenant_id, name, description, goal, steps, default_risk, required_tools)
SELECT
  'dynamic-plan-step',
  'system',
  NULL,
  'Dinamik Plan Adımı',
  'Operasyon planlayıcısının ürettiği tek adımlık çalıştırma; step_spec run answers_json ile beslenir.',
  'Planlanan adımı tamamla.',
  '[
    {
      "id": "plan-1",
      "agent": "Operator",
      "goal": "step_spec.topic hedefini tamamla; step_spec.deliverables varsa üret.",
      "output": "Adım çıktısı özeti."
    }
  ]'::jsonb,
  'R1',
  ARRAY[]::text[]
WHERE NOT EXISTS (
  SELECT 1 FROM public.playbooks
  WHERE slug = 'dynamic-plan-step' AND pack_id = 'system' AND tenant_id IS NULL
);

-- ── 3. policy seeds ──────────────────────────────────────────────────────────

INSERT INTO public.policy_settings (owner_user_id, key, value, description)
SELECT NULL, 'planner.enabled', 'false'::jsonb,
  'Operasyon DECIDE plan_step modu. false = mevcut davranış (geriye uyumlu).'
WHERE NOT EXISTS (
  SELECT 1 FROM public.policy_settings
  WHERE key = 'planner.enabled' AND owner_user_id IS NULL
);

INSERT INTO public.policy_settings (owner_user_id, key, value, description)
SELECT NULL, 'tools.semantic_top_k', '0'::jsonb,
  'Semantic araç top-k (0=kapalı, 8=varsayılan aktif). Compensation/read muaf.'
WHERE NOT EXISTS (
  SELECT 1 FROM public.policy_settings
  WHERE key = 'tools.semantic_top_k' AND owner_user_id IS NULL
);

NOTIFY pgrst, 'reload schema';
