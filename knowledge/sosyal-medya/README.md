# Sosyal Medya Knowledge

Bu klasör, `sosyal-medya` domain pack çalıştırmaları için marka ve SSS bilgi tabanı iskeletidir.

## İçerik

- **Marka sesi** — ton, üslup, yasaklı ifadeler, örnek cümleler (tenant tarafından doldurulur).
- **SSS** — sık sorulan sorular ve onaylı yanıt şablonları (`faq.jsonl`, PR-S3'te eklenecek).
- **Yasaklı konular** — otomatik yanıt veya içerik üretiminde kaçınılacak başlıklar.

## Dosyalar

| Dosya | Açıklama |
|---|---|
| `README.md` | Bu dosya — klasör yapısı ve kullanım notları |
| `faq.jsonl` | (PR-S3) Satır bazlı SSS kayıtları — community-manager önce buradan arar |

## Notlar

- Tenant'a özel marka rehberi portal veya `facts` terfisi ile genişletilebilir.
- Hassas ve kriz içerikli yorumlar SSS ile otomatik yanıtlanmaz; eskale edilir.
