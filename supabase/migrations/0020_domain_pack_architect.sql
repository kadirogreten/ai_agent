-- ============================================================
-- 0020_domain_pack_architect.sql
-- DOMAIN_PACK_ARCHITECT ajanı + sector-discovery meta-playbook
-- ============================================================

-- ── 1. role CHECK constraint'ını genişlet ────────────────────
ALTER TABLE public.agents
    DROP CONSTRAINT IF EXISTS agents_role_check;

ALTER TABLE public.agents
    ADD CONSTRAINT agents_role_check
    CHECK (role IN (
        'research','analysis','writing','editing',
        'verification','operation','contrarian','design','code',
        'architecture'   -- yeni: domain pack tasarımcısı
    ));


-- ── 2. system pack (meta-playbook kapsayıcısı) ───────────────
INSERT INTO domain_packs (
    id, name, description, tenant_id, status, version,
    allowed_domains, meta
)
VALUES (
    'system',
    'System',
    'AgentArmy sistem playbook''ları ve meta-akışlar. Direkt kullanılmaz; yönlendirici olarak çalışır.',
    NULL,
    'active',
    1,
    '{}',
    '{"isSystemPack": true}'::jsonb
)
ON CONFLICT (id) DO UPDATE SET
    name        = EXCLUDED.name,
    description = EXCLUDED.description,
    status      = EXCLUDED.status,
    meta        = EXCLUDED.meta,
    updated_at  = now();


-- ── 3. DOMAIN_PACK_ARCHITECT agent seed ──────────────────────
INSERT INTO agents (
    name, code, description,
    role, risk_ceiling, cost_class,
    behaviors, system_prompt,
    tenant_overridable,
    tenant_id
)
VALUES (
    'Domain Pack Architect',
    'DOMAIN_PACK_ARCHITECT',
    'Kullanıcı tarafından verilen sektör açıklamasından tam bir domain pack taslağı üretir. Çıktı JSON domain_pack_drafts tablosuna kaydedilir.',
    'architecture',
    'R2',
    'high',
    jsonb_build_object(
        'WritesToFacts',            false,
        'WritesToDecisions',        false,
        'CapturesVerifierReport',   false,
        'TriggersContrarian',       false,
        'RequiresWebSearch',        true,
        'RequiresFullContext',      true,
        'AcceptsRubric',            true,
        'PrefersDomainAllowlist',   false
    ),
    $PROMPT$
Sen bir "Domain Pack Architect" ajanısın. Görevin, kullanıcının kısa bir doğal dil açıklamasından (örneğin: "fintech kredi skorlama", "sağlık turizminde hasta yönlendirme") eksiksiz bir AgentArmy domain pack taslağı üretmektir.

# Çıktı Formatı (JSON)
Kesinlikle geçerli, aşağıdaki yapıda bir JSON döndür — JSON dışında başka metin olmayacak:

```json
{
  "id": "<kebab-case-pack-slug>",
  "name": "<Türkçe ticari isim>",
  "description": "<1-2 cümle>",
  "allowed_domains": ["<kaynak-domain-1>", "<kaynak-domain-2>"],
  "glossary_md": "## Sözlük\n| Terim | Tanım |\n|---|---|\n...",
  "regulatory_notes_md": "## Regülasyon Notları\n...",
  "verifier_rubric_md": "## Doğrulayıcı Rubrik\n...",
  "playbooks": [
    {
      "slug": "<slug>",
      "name": "<isim>",
      "description": "<açıklama>",
      "goal": "<tek cümle hedef>",
      "default_risk": "R0|R1|R2|R3",
      "required_tools": [],
      "tags": [],
      "steps": [
        {
          "id": "<adım-id>",
          "agent": "Researcher|Analyst|Writer|Editor|Verifier|Planner",
          "goal": "<adım hedefi>",
          "output": "<beklenen çıktı>"
        }
      ]
    }
  ],
  "personas": [
    {
      "slug": "<persona-slug>",
      "name": "<isim>",
      "role_description": "<kısa rol açıklaması>",
      "system_prompt": "<persona system prompt>",
      "risk_ceiling": "R1|R2|R3",
      "cost_class": "low|medium|high",
      "behaviors": {}
    }
  ],
  "bundles": [
    {
      "slug": "<bundle-slug>",
      "name": "<isim>",
      "description": "<açıklama>",
      "playbook_slugs": ["<slug1>", "<slug2>"],
      "default_risk": "R1"
    }
  ]
}
```

# Kurallar
1. Minimum 4, maksimum 8 playbook oluştur.
2. Her playbook için minimum 3, maksimum 6 adım (step) tanımla.
3. En az 2 persona ekle (biri domain uzmanı, biri doğrulayıcı rolünde).
4. En az 1 bundle ekle (temel iş akışını kapsar).
5. Glossary: 8-15 terim içermeli.
6. Regulatory notes: sektöre özgü yasal uyumluluk notları (KVKK, sektörel regülasyon).
7. Verifier rubric: 5-10 maddelik denetim kriteri.
8. Risk: kullanıcı verisi veya hassas karar içeren adımlara R2, yasal belge üretimi R3.
9. Sadece JSON döndür — başında/sonunda markdown code block dahil başka metin olmayacak.
$PROMPT$,
    true,
    NULL    -- NULL = sistem ajanı (tüm tenant'lara görünür)
)
ON CONFLICT (code) DO UPDATE SET
    name               = EXCLUDED.name,
    description        = EXCLUDED.description,
    role               = EXCLUDED.role,
    risk_ceiling       = EXCLUDED.risk_ceiling,
    cost_class         = EXCLUDED.cost_class,
    behaviors          = EXCLUDED.behaviors,
    system_prompt      = EXCLUDED.system_prompt,
    tenant_overridable = EXCLUDED.tenant_overridable,
    updated_at         = now();


-- ── 4. Meta-playbook: sector-discovery-and-scaffold ──────────
INSERT INTO playbooks (
    slug, pack_id, tenant_id,
    name, description, goal,
    steps, default_risk,
    required_tools, tags,
    content_json, version
)
VALUES (
    'sector-discovery-and-scaffold',
    'system',
    NULL,
    'Sektör Keşif ve İskelet Oluşturma',
    'Kullanıcının sektör açıklamasından araştırma + analiz + domain pack JSON taslağı üretim akışı.',
    'Sektör araştırması yap, regülasyon boşluklarını tespit et ve tam bir domain pack JSON taslağı çıkar.',
    '[
      {
        "id": "sector_research",
        "agent": "Researcher",
        "goal": "Sektörün temel iş akışlarını, yasal gereksinimlerini ve rekabetçi araçları belirle. En az 5 güvenilir kaynak bul.",
        "output": "Sektör özeti: iş akışları + yasal gereksinimler + rekabet haritası"
      },
      {
        "id": "gap_analysis",
        "agent": "Analyst",
        "goal": "Mevcut domain pack''lerle örtüşen ve örtüşmeyen alanları analiz et. Hangi playbook''ların gerekli olduğunu listele.",
        "output": "Boşluk analizi tablosu + önerilen playbook listesi"
      },
      {
        "id": "scaffold",
        "agent": "DomainPackArchitect",
        "goal": "Araştırma ve analiz bulgularını kullanarak eksiksiz domain pack JSON taslağı oluştur.",
        "output": "Tam domain pack JSON (id, name, description, allowed_domains, glossary_md, regulatory_notes_md, verifier_rubric_md, playbooks, personas, bundles)"
      },
      {
        "id": "verify",
        "agent": "Verifier",
        "goal": "JSON geçerliliğini, playbook adımlarının tutarlılığını, risk sınıfı atamalarını ve regülasyon kapsama oranını doğrula.",
        "output": "Denetim raporu + PASS/FAIL + varsa eksik alanlar listesi"
      }
    ]'::jsonb,
    'R2',
    ARRAY['web_search'],
    ARRAY['meta','sector-discovery','domain-pack'],
    '{"version":1,"id":"sector-discovery-and-scaffold","title":"Sektör Keşif ve İskelet Oluşturma","defaultRisk":"R2","isMetaPlaybook":true}'::jsonb,
    1
)
ON CONFLICT (slug, pack_id, tenant_id) DO UPDATE SET
    name         = EXCLUDED.name,
    description  = EXCLUDED.description,
    goal         = EXCLUDED.goal,
    steps        = EXCLUDED.steps,
    default_risk = EXCLUDED.default_risk,
    required_tools = EXCLUDED.required_tools,
    tags         = EXCLUDED.tags,
    content_json = EXCLUDED.content_json,
    updated_at   = now();
