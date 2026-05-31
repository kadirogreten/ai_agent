# Market Intel — Verifier Rubriği

Bu rubrik, market/competitive intelligence çıktılarında doğruluk ve izlenebilirlik için minimum kriterleri tanımlar. **Faz B (substance verifier) güncellemesi:** form kontrollerine ek olarak URL liveness, tarih tutarlılığı ve dürüst kıtlık zorunlu hale geldi.

## 1. Form kontrolleri (PASS/FAIL)

FAIL ver:

- "Kaynakça" veya "Kaynaklar" bölümü yoksa.
- Kritik iddialar URL'sizse.
- "Belirsiz", "tahmini", "kaynak yok" gibi ifadeler kritik iddiaya eklenmiş ama açıklama/kanıt yoksa.
- Pazar büyüklüğü / CAGR / gelir / kullanıcı sayısı gibi sayısal iddialar URL'sizse.

PASS için form tarafı:

- Belirsizlikler açıkça etiketlenmiş ve "neden belirsiz" açıklanmışsa.

## 2. Substance kontrolleri (PASS/FAIL) — **ZORUNLU**

İzinli araçlar arasında `link_check` varsa **kullan** ve sonuçlarını rapora yansıt.

FAIL ver:

- **Dead URL:** `link_check` 404, 5xx, timeout veya bağlantı hatası dönen URL varsa.
- **Anakronistik tarih:** içerik "son hafta", "son 7 gün", "bu ay" gibi güncel pencereye atıfsa ve URL'lerde belirgin biçimde eski yıllar (brief'in koşulduğu yıldan ≥ 1 yıl eski) varsa.
- **Sahte kaynak şüphesi:** URL düzgün biçimlendirilmiş ama içeriği iddia ile uyumsuz görünüyorsa (örn. iddia: "Asana, X şirketini satın aldı"; URL: random blog post). Verifier kendi yargısıyla işaretlesin.
- **Domain çok-tekrar:** ≥ 10 URL'den ≥ 8'i tek domain'den geliyorsa (kaynak çeşitliliği zayıf).

## 3. Dürüst kıtlık kuralı

- Research adımı az kalem (örn. < 5) döndürdüyse Writer'ı kalem sayısını artırmaya zorlama. Kıtlığın açıkça beyan edilmiş olması (örn. "bu hafta sektörde belirgin aktivite görülmedi") yeterlidir ve PASS verilebilir.
- Writer'ın research'te olmayan yeni iddia/URL eklediği tespit edilirse → FAIL (hallüsinasyon).
- "10 madde olmak zorunda" kuralı yok. Hedef: research'te N kalem varsa brief'te de yaklaşık N kalem (ne fazla, ne eksik).

## 4. Kalite Notları

- Aynı domain'den çok sayıda kaynak yerine, kaynak çeşitliliği tercih edilir.
- Blog/PR içerikleri "düşük güven" olarak etiketlenir.
- Paywall kaynaklar kullanılabilir; ama erişim kısıtı not düşülür.
- Verifier'ın denetim raporu, kontrol tablosunda her URL için `link_check` sonucunu (status code) içermelidir. Tablo yoksa rapor eksiktir.

## 5. Çıktı formatı

Verifier her zaman şu yapıda rapor üretir:

1. **Kontrol tablosu** — kriter | sonuç | sayım/not (URL'ler için: url | status | tarih tutarlı mı | iddia ile uyumlu mu).
2. **Sorunlar listesi** — kategoriye göre (Dead URL / Anakronistik tarih / Sahte şüphesi / Form eksik / Hallüsinasyon).
3. **Düzeltme önerileri** — Editor'ün ne yapacağını net söyle (ör. "iddia 3'ü ve URL'sini sil").
4. **PASS/FAIL** — herhangi bir FAIL kriteri tetiklenmişse FAIL.
