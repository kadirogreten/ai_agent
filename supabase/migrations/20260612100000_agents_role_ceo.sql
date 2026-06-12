-- agents.role CHECK kısıtına 'ceo' eklenir.
-- Gerekçe: 3D Ofis CEO odası + CEO ajanı (yönetim/delegasyon rolü) — form rol
-- listesinde ve DB kısıtında 'ceo' yoktu; ajan ancak kod/ad eşleşmesiyle tanınıyordu.
-- Desen: 20260609120000_tedarik_stock_levels.sql (DROP + ADD CHECK revizyonu).

ALTER TABLE public.agents DROP CONSTRAINT IF EXISTS agents_role_check;

-- NOT: canlı veride role='architecture' satırı var (Domain Pack Architect) —
-- eski CHECK listesinde olmamasına rağmen girmiş (muhtemelen kısıt geçici
-- düşürülmüşken seed edildi). Yeni kısıt mevcut veriyi kapsamak zorunda.
ALTER TABLE public.agents
  ADD CONSTRAINT agents_role_check
  CHECK (role IN ('research','analysis','writing','editing','verification',
                  'operation','contrarian','design','code','architecture','ceo'));

COMMENT ON COLUMN public.agents.role IS
  'Fonksiyonel rol. ceo = yönetim/delegasyon (3D Ofis CEO odası bu rolle eşleşir).';

-- Mevcut CEO ajanını (kod=CEO) yeni role taşı — idempotent.
UPDATE public.agents SET role = 'ceo' WHERE code = 'CEO' AND role IS NULL;
