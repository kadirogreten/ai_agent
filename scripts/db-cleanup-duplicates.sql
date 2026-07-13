-- ════════════════════════════════════════════════════════════════════════════
--  AgentArmy — Mükerrer Veri Temizliği (AUDIT + CLEANUP)
--  Supabase SQL Editor'de çalıştır. Remote DB (production).
--
--  KULLANIM:
--    1) Önce PART 1 (AUDIT) bloklarını çalıştır — HİÇBİR ŞEY SİLMEZ, sadece gösterir.
--    2) Çıktıyı incele, hangi pack'i tutacağına karar ver.
--    3) PART 2'nin TAMAMINI birlikte seç ve çalıştır — sonunda ROLLBACK var,
--       sadece sayıları görürsün, hiçbir şey kalıcı olmaz.
--    4) İkna olunca en alttaki ROLLBACK'i COMMIT yapıp tekrar çalıştır.
--
--  ŞEMA NOTLARI (0019_domain_packs.sql'den doğrulandı):
--    - playbooks.pack_id / personas.pack_id / playbook_bundles.pack_id
--      → domain_packs(id) ON DELETE CASCADE
--      Yani bir domain_packs satırını silmek çocuklarını (playbook/persona/bundle)
--      OTOMATİK siler. Ayrı ayrı silmeye gerek yok.
--    - domain_pack_drafts.merged_pack_id → domain_packs(id) ON DELETE SET NULL
--      Pack silinince draft kaydı kalır, sadece linki NULL olur.
--    - operations.domain_pack / run_requests.domain_pack → TEXT (FK DEĞİL)
--      Pack silinse de bu geçmiş kayıtlar durur; sadece artık olmayan bir slug'a
--      işaret ederler. Bilinçli olarak repoint veya öylece bırakılabilir.
-- ════════════════════════════════════════════════════════════════════════════


-- ════════════════════════════════════════════════════════════════════════════
--  PART 1 — AUDIT  (salt-okunur; güvenle çalıştır)
-- ════════════════════════════════════════════════════════════════════════════

-- 1.1  Aynı ADI paylaşan domain pack'ler (mükerrer paket adayları).
SELECT
    dp.name,
    count(*)                                        AS pack_sayisi,
    array_agg(dp.id ORDER BY dp.created_at)         AS pack_idler,
    array_agg(dp.created_at ORDER BY dp.created_at) AS olusturmalar
FROM domain_packs dp
GROUP BY dp.name
HAVING count(*) > 1
ORDER BY pack_sayisi DESC, dp.name;

-- 1.2  Her pack için çocuk sayıları (hangisi "dolu/doğru" karar vermek için).
SELECT
    dp.id                                       AS pack_id,
    dp.name,
    dp.status,
    dp.tenant_id,
    dp.created_at,
    (SELECT count(*) FROM playbooks         p  WHERE p.pack_id     = dp.id) AS playbook_sayisi,
    (SELECT count(*) FROM personas          pe WHERE pe.pack_id    = dp.id) AS persona_sayisi,
    (SELECT count(*) FROM playbook_bundles  b  WHERE b.pack_id     = dp.id) AS bundle_sayisi,
    (SELECT count(*) FROM operations        o  WHERE o.domain_pack = dp.id) AS operasyon_ref,
    (SELECT count(*) FROM run_requests      r  WHERE r.domain_pack = dp.id) AS run_ref
FROM domain_packs dp
WHERE dp.name IN (SELECT name FROM domain_packs GROUP BY name HAVING count(*) > 1)
ORDER BY dp.name, dp.created_at;

-- 1.3  Mükerrer taslaklar: aynı proposed_pack_id'den birden çok kayıt.
SELECT
    d.proposed_pack_id,
    d.status,
    count(*)                                        AS adet,
    array_agg(d.id ORDER BY d.created_at)           AS draft_idler,
    array_agg(d.created_at ORDER BY d.created_at)   AS olusturmalar
FROM domain_pack_drafts d
GROUP BY d.proposed_pack_id, d.status
HAVING count(*) > 1
ORDER BY adet DESC;

-- 1.4  Bekleyen (pending) mükerrer taslaklar — dedup migration sonrası 0 olmalı.
SELECT tenant_id, proposed_pack_id, count(*) AS pending_adet
FROM domain_pack_drafts
WHERE status = 'pending'
GROUP BY tenant_id, proposed_pack_id
HAVING count(*) > 1;

-- 1.5  Yetim (orphan) kontrolü — pack_id artık domain_packs'te yoksa (olmamalı, FK var).
SELECT 'playbooks' AS tablo, p.id::text, p.slug, p.pack_id
FROM playbooks p LEFT JOIN domain_packs dp ON dp.id = p.pack_id
WHERE dp.id IS NULL
UNION ALL
SELECT 'personas', pe.id::text, pe.slug, pe.pack_id
FROM personas pe LEFT JOIN domain_packs dp ON dp.id = pe.pack_id
WHERE dp.id IS NULL;


-- ════════════════════════════════════════════════════════════════════════════
--  PART 2 — CLEANUP  (transaction; VARSAYILAN ROLLBACK — hiçbir şey kalıcı olmaz)
--
--  id'ler satır içine yazılı. İki id'yi AUDIT çıktısına göre TEYİT ET; farklıysa
--  editörde "Find & Replace" ile toptan değiştir:
--     TUTULACAK  (canonical): techmora-sektor-istihbarat
--     SİLİNECEK  (duplicate): techmora-sektor-istihbarat-paketi
--
--  PART 2'nin TAMAMINI birlikte seçip çalıştır (tek transaction).
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 2.1  Silinecek pack'lerin çocuk sayılarını göster (cascade ile gidecekler) ──
--    SİLİNECEK kopyalar: techmora-sektor-istihbarat-paketi + techmora-sektor-zekasi
--    (zekasi'yi TUTMAK istersen aşağıdaki üç yerdeki IN listesinden çıkar.)
SELECT
    dp.id                                                          AS silinecek_pack,
    dp.name,
    (SELECT count(*) FROM playbooks        WHERE pack_id     = dp.id) AS playbook,
    (SELECT count(*) FROM personas         WHERE pack_id     = dp.id) AS persona,
    (SELECT count(*) FROM playbook_bundles WHERE pack_id     = dp.id) AS bundle,
    (SELECT count(*) FROM operations       WHERE domain_pack = dp.id) AS operasyon_ref,
    (SELECT count(*) FROM run_requests     WHERE domain_pack = dp.id) AS run_ref
FROM domain_packs dp
WHERE dp.id IN ('techmora-sektor-istihbarat-paketi', 'techmora-sektor-zekasi');

-- ── 2.2  (Opsiyonel) Geçmiş operasyonları/run'ları canonical'a repoint et ──
--    İstemezsen bu iki UPDATE'i yorum satırı yap; geçmiş job'lar değişmez, sorun olmaz.
UPDATE operations   SET domain_pack = 'techmora-sektor-istihbarat'
WHERE domain_pack IN ('techmora-sektor-istihbarat-paketi', 'techmora-sektor-zekasi');

UPDATE run_requests SET domain_pack = 'techmora-sektor-istihbarat'
WHERE domain_pack IN ('techmora-sektor-istihbarat-paketi', 'techmora-sektor-zekasi');

-- ── 2.3  Mükerrer pack'leri sil → playbooks/personas/bundles CASCADE ile gider ──
DELETE FROM domain_packs
WHERE id IN ('techmora-sektor-istihbarat-paketi', 'techmora-sektor-zekasi');

-- ── 2.4  Mükerrer 'merged' taslak kayıtlarını temizle ──
--    Her (tenant_id, proposed_pack_id) için EN YENİ merged taslağı tut, eskileri sil.
WITH ranked AS (
    SELECT id,
           row_number() OVER (
               PARTITION BY tenant_id, proposed_pack_id
               ORDER BY created_at DESC
           ) AS rn
    FROM domain_pack_drafts
    WHERE status = 'merged'
)
DELETE FROM domain_pack_drafts d
USING ranked r
WHERE d.id = r.id AND r.rn > 1;

-- ── 2.5  Sonuç kontrolü: kalan TechMora pack'leri ve draft'ları ──
SELECT 'kalan pack' AS ne, id AS anahtar, name AS deger, status AS ek FROM domain_packs
WHERE name ILIKE '%TechMora%'
UNION ALL
SELECT 'kalan draft', proposed_pack_id, status, created_at::text FROM domain_pack_drafts
WHERE proposed_pack_id ILIKE '%techmora%'
ORDER BY 1;

-- ══════════════════════════════════════════════════════════════════════════
--  Sayılar doğruysa: aşağıdaki ROLLBACK satırını COMMIT ile değiştir.
--  Emin değilsen ROLLBACK bırak — hiçbir değişiklik kalıcı olmaz.
-- ══════════════════════════════════════════════════════════════════════════
ROLLBACK;
-- COMMIT;
