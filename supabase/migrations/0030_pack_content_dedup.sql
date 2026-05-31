-- Sync-to-db duplikelerini önle: platform-tenant (tenant_id NULL) satırlar için
-- partial unique index + mevcut duplikeleri temizle.
--
-- Sorun: Postgres'in UNIQUE constraint'i NULL'ı eşitlemiyor (NULL ≠ NULL kuralı).
-- Mevcut "UNIQUE (slug, pack_id, tenant_id)" constraint'i tenant_id NULL satırlarda
-- devreye girmediği için her sync-to-db çalıştığında platform-tenant playbook/persona
-- satırları biriyordu. UI dropdown'larında bu "iki kez gözüküyor" olarak ortaya çıktı.
--
-- Çözüm:
--   1) Mevcut duplikeleri temizle (her grupta en yeni created_at'i tut).
--   2) Partial UNIQUE INDEX ekle: yalnız tenant_id NULL satırlarda (slug, pack_id)
--      tekilliği zorla. Tenant-specific override'lar (tenant_id IS NOT NULL) etkilenmez.
--
-- Not: SyncToDb.cs eş zamanlı olarak per-row DELETE+INSERT akışına geçti
-- (idempotent), böylece gelecekte bu index'e hiç çarpılmaz.

-- ──────────────────────────────────────────────────────────────────────────────
-- 1. Playbooks: duplikeleri temizle + partial unique index
-- ──────────────────────────────────────────────────────────────────────────────
DELETE FROM public.playbooks p
USING public.playbooks q
WHERE p.tenant_id IS NULL
  AND q.tenant_id IS NULL
  AND p.slug    = q.slug
  AND p.pack_id = q.pack_id
  AND p.created_at < q.created_at;

CREATE UNIQUE INDEX IF NOT EXISTS ux_playbooks_slug_pack_platform
  ON public.playbooks (slug, pack_id)
  WHERE tenant_id IS NULL;

-- ──────────────────────────────────────────────────────────────────────────────
-- 2. Personas: duplikeleri temizle + partial unique index
--    Not: personas.pack_id NULL olabilir (cross-domain personalar). COALESCE ile
--    index expression'unda NULL'ı boş string'e çevirip tekillik sağlanır.
-- ──────────────────────────────────────────────────────────────────────────────
DELETE FROM public.personas p
USING public.personas q
WHERE p.tenant_id IS NULL
  AND q.tenant_id IS NULL
  AND p.slug = q.slug
  AND (p.pack_id IS NOT DISTINCT FROM q.pack_id)
  AND p.created_at < q.created_at;

CREATE UNIQUE INDEX IF NOT EXISTS ux_personas_slug_pack_platform
  ON public.personas (slug, COALESCE(pack_id, ''))
  WHERE tenant_id IS NULL;
