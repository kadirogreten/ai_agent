-- FIX: Sektör fabrikası her koşumda AYNI taslağı iki kez oluşturuyor.
-- Sebep: iki ayrı yazım yolu — C# DomainPackDraftWriter (Runner sector-* post-hook)
-- + TS runRequestWorker.saveDraft (sector_factory) — ikisi de aynı run için
-- domain_pack_drafts'a insert ediyor. Biri eval_generator enqueue edip 'passed'
-- oluyor (merge edilir), diğeri 'pending'de takılıp kullanıcıyı şaşırtıyor.
--
-- Çözüm: aynı (tenant_id, proposed_pack_id) için en fazla BİR 'pending' taslak.
-- İkinci eşzamanlı insert 23505 ile temiz reddedilir (yazıcılar zaten catch'liyor).
-- 'merged'/'rejected' durumları kısıt dışı → yeniden üretim (re-draft) serbest.
-- Retry (sector-paket-taslak fail → yeni tur) mevcut pending'i güncelleyebilir;
-- yeni pending eklemeye çalışırsa zaten aynısı olduğu için engellenmesi doğru.

-- ── 1. Mevcut dublikat 'pending' taslakları temizle ──────────────────────────
-- Her (tenant_id, proposed_pack_id) grubunda en yeni pending'i tut; eskileri
-- 'rejected' yap (silmek yerine — iz kalsın, RLS/geçmiş bozulmasın).
WITH ranked AS (
  SELECT
    id,
    row_number() OVER (
      PARTITION BY tenant_id, proposed_pack_id
      ORDER BY created_at DESC
    ) AS rn
  FROM public.domain_pack_drafts
  WHERE status = 'pending'
)
UPDATE public.domain_pack_drafts d
SET status = 'rejected'
FROM ranked r
WHERE d.id = r.id AND r.rn > 1;

-- ── 2. Kısmi tekillik indeksi ───────────────────────────────────────────────
-- Yalnız 'pending' satırlarda benzersizlik; merged/rejected serbest.
CREATE UNIQUE INDEX IF NOT EXISTS domain_pack_drafts_pending_unique
  ON public.domain_pack_drafts (tenant_id, proposed_pack_id)
  WHERE status = 'pending';
