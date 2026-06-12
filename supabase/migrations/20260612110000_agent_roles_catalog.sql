-- agent_roles katalog tablosu: slug-keyed rol tanımları (label, color, icon, desc).
-- agents.role CHECK kısıtı kaldırılır → FK ile doğruluk DB'de garantilenir.
-- RLS: authenticated okuyabilir; yazma service_role.
-- Desen: 20260612100000_agents_role_ceo.sql (DROP CHECK + yeni kısıt revizyonu).

-- ── Katalog tablosu ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.agent_roles (
  slug        TEXT        PRIMARY KEY,
  label       TEXT        NOT NULL,
  description TEXT        NOT NULL DEFAULT '',
  color       TEXT        NOT NULL DEFAULT '#64748b',  -- CSS hex
  icon        TEXT        NOT NULL DEFAULT 'Bot',       -- lucide ikon adı
  sort_order  INT         NOT NULL DEFAULT 99,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Seed: mevcut 11 statik rol ────────────────────────────────────────────────
-- Renkler / ikonlar: AgentsPage ROLE_COLORS/ROLE_ICONS statik haritalarından alındı.
INSERT INTO public.agent_roles (slug, label, description, color, icon, sort_order)
VALUES
  ('ceo',          'CEO / Yönetim', 'Hedef bölme, delegasyon, eskalasyon yönetimi',  '#facc15', 'Crown',        1),
  ('research',     'Araştırma',     'Kaynak tarar, not çıkarır',                     '#818cf8', 'Globe',        2),
  ('analysis',     'Analiz',        'İddiaları test eder, tutarlılık kontrolü',      '#a78bfa', 'FlaskConical', 3),
  ('writing',      'Yazım',         'Rapor / metin üretir',                          '#f472b6', 'Pen',          4),
  ('editing',      'Editör',        'Dil, ton, format standardı',                    '#fb923c', 'Pen',          5),
  ('verification', 'Denetçi',       'Kaynak doğrulama, risk etiketleme',             '#34d399', 'Shield',       6),
  ('operation',    'Operatör',      'Araç çağırır, otomasyon yapar',                 '#60a5fa', 'Wrench',       7),
  ('contrarian',   'Contrarian',    '"Bu neden yanlış olabilir?" raporu',            '#f87171', 'X',            8),
  ('design',       'Tasarım',       'UI/UX, görsel tasarım görevleri',               '#e879f9', 'Monitor',      9),
  ('code',         'Kod',           'Yazılım geliştirme, teknik analiz',             '#4ade80', 'Code2',       10),
  ('architecture', 'Mimari',        'Domain pack / sistem iskeleti tasarımı',        '#2dd4bf', 'Boxes',       11),
  ('coordination', 'Koordinasyon',  'Paydaş yönetimi, süreç koordinasyonu, raporlama','#38bdf8', 'Users',       12)
ON CONFLICT (slug) DO UPDATE SET
  label       = EXCLUDED.label,
  description = EXCLUDED.description,
  color       = EXCLUDED.color,
  icon        = EXCLUDED.icon,
  sort_order  = EXCLUDED.sort_order;

-- ── CHECK kısıtını düşür → FK ile değiştir ───────────────────────────────────
-- Mevcut kısıt adı: agents_role_check (0020_domain_pack_architect + 20260612100000).
ALTER TABLE public.agents DROP CONSTRAINT IF EXISTS agents_role_check;

-- DEFERRABLE: toplu seed/import sırasında FK döngülerini önler.
ALTER TABLE public.agents
  ADD CONSTRAINT agents_role_fk
  FOREIGN KEY (role)
  REFERENCES public.agent_roles (slug)
  ON UPDATE CASCADE
  DEFERRABLE INITIALLY DEFERRED;

-- ── RLS ──────────────────────────────────────────────────────────────────────
ALTER TABLE public.agent_roles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "agent_roles_select"
  ON public.agent_roles
  FOR SELECT TO authenticated
  USING (true);

-- service_role bypasses RLS → yazma yetki ayrıca politika gerektirmez.

COMMENT ON TABLE  public.agent_roles          IS 'Fonksiyonel ajan rolleri kataloğu. Yeni rol = yeni satır; deploy gerekmez.';
COMMENT ON COLUMN public.agent_roles.color    IS 'CSS hex (#rrggbb). Portal ve 3D ofis burada okur.';
COMMENT ON COLUMN public.agent_roles.icon     IS 'Lucide ikon adı (ör. Globe, Shield). Portal ICON_MAP ile çözülür.';

-- ── Mevcut ajanlara kod → rol eşlemesi ───────────────────────────────────────
-- role IS NULL olanlar (8 ajan) panelde 'executor' fallback'iyle görünüyordu.
-- İdempotent: yalnız boş roller doldurulur; kullanıcı ataması ezilmez.
UPDATE public.agents SET role = v.role
FROM (VALUES
  ('RESEARCHER',         'research'),
  ('ANALYST',            'analysis'),
  ('WRITER',             'writing'),
  ('EDITOR',             'editing'),
  ('VERIFIER',           'verification'),
  ('OPERATOR',           'operation'),
  ('CONTRARIAN',         'contrarian'),
  ('SOFTWARE_DEVELOPER', 'code'),
  ('GRAFIC_DESIGNER',    'design'),
  ('DOMAIN_PACK_ARCHITECT', 'architecture'),
  ('COORDINATOR',        'coordination'),
  ('CEO',                'ceo')
) AS v(code, role)
WHERE public.agents.code = v.code AND public.agents.role IS NULL;
