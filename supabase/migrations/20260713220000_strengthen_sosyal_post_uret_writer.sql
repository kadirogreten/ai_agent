-- Sosyal-medya 'sosyal-post-uret' playbook'unun Writer adımını güçlendir.
-- SEBEP (canlı gözlem): Writer talimatı "post metni üret, kurallara uy" düzeyinde jenerikti;
-- model içeriği platforma göre OPTİMİZE etmek yerine LinkedIn'de kopyalıyor, IG/X'te kısaltıyor,
-- Türkçe sürümleri atlıyordu → "kısa ve yetersiz" çıktı. Yeni talimat: platforma özgü hook +
-- yeniden kurgula (salt kopyalama/kısaltma yasak), EN+TR (kullanıcı talebi öncelikli), TÜM
-- içerikleri işle, atlama yok. Verifier adımı da tamlık + dil + kopya kontrolü yapacak.
-- Sistem playbook'u (tenant_id IS NULL) → tüm tenant'ları etkiler.

UPDATE public.playbooks
SET
  description = 'Kaynak içerikleri platforma özel (LinkedIn/Instagram/X), EN+TR, yayına hazır caption''lara dönüştürür — salt kopyalama değil, optimize eder.',
  goal = $g$Kaynak materyaldeki her içeriği LinkedIn, Instagram ve X için optimize edilmiş, yayına hazır caption'lara dönüştür (salt kopyalama/kısaltma değil).$g$,
  steps = $json$[
    {
      "id": "s1",
      "agent": "Writer",
      "goal": "Kaynak materyaldeki HER içeriği LinkedIn, Instagram ve X (Twitter) için AYRI AYRI yayına hazır caption'a dönüştür. KURALLAR: (1) Salt kopyalama veya sadece kısaltma YAPMA — her platform için özgün ve güçlü bir açılış (hook) yaz, mesajı platforma özgü yeniden kurgula, değer katan bağlam ekle. (2) LinkedIn: tam derinlik, özgün açı, profesyonel; Instagram: tarama-dostu, samimi, görsel odaklı; X: vurucu ve kısa, uygunsa numaralı thread. (3) DİL: kullanıcının cevaplarında dil talebi varsa BİREBİR ona uy; aksi belirtilmedikçe her caption'ı ÖNCE İngilizce SONRA native Türkçe yaz (çeviri değil, o dilde doğal). (4) Her içerik + platform için: başlık, gövde metni, platforma uygun CTA, görsel brief, önerilen hashtag'ler. (5) Kaynaktaki içeriklerin TAMAMINI işle — 'aynı formatta devam edilecektir' gibi atlama/kısaltma YAPMA, yeni içerik UYDURMA; yalnızca verilen içerikleri kullan.",
      "output": "Her kaynak içerik için LinkedIn/Instagram/X caption'ları (talep edilen dil(ler)de), başlık, CTA, görsel brief ve hashtag'ler."
    },
    {
      "id": "s2",
      "agent": "Verifier",
      "goal": "Post taslaklarını denetle: (a) kaynaktaki TÜM içerikler işlenmiş mi, atlanan/eksik var mı; (b) her içerik 3 platform (LinkedIn/Instagram/X) için de üretilmiş mi; (c) dil kuralı uygulanmış mı (kullanıcı talebi ya da EN+TR); (d) salt kopyala-yapıştır yerine platforma özgü uyarlama yapılmış mı; (e) marka sesi, yasaklı içerik, CTA varlığı, hashtag limiti. Bunlardan biri sağlanmıyorsa VERDICT: FAIL yaz ve tam olarak neyin eksik/kopya/atlanmış olduğunu listele.",
      "output": "post-taslagi.md — onaylı caption seti veya VERDICT: FAIL + düzeltme listesi.",
      "blockOnVerifierFail": true
    }
  ]$json$::jsonb,
  updated_at = now()
WHERE slug = 'sosyal-post-uret'
  AND pack_id = 'sosyal-medya'
  AND tenant_id IS NULL;

NOTIFY pgrst, 'reload schema';
