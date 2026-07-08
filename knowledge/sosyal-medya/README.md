# Sosyal Medya Knowledge

Bu klasör insan-okur dokümantasyon içindir. **SSS ve facts verisi dosyada tutulmaz.**

## İçerik

- **Marka sesi** — ton, üslup, yasaklı ifadeler, örnek cümleler (tenant tarafından doldurulur).
- **SSS** — sık sorulan sorular ve onaylı yanıt şablonları Supabase `facts` tablosunda (`domain_pack='sosyal-medya'`, `source_domain='sosyal-medya-faq'`).
- **Yasaklı konular** — otomatik yanıt veya içerik üretiminde kaçınılacak başlıklar.

## Veri kaynağı

- Tek hakikat kaynağı: Supabase `facts` tablosu (`FactsStore` / `FactsIndex` — `src/AgentArmy.Cli/Knowledge/`).
- Community-manager persona yanıt üretmeden önce `FactsIndex.SearchAsync` ile ilgili SSS kayıtlarını arar.
- Tenant veya pack'e özel notlar portal üzerinden veya run çıktılarından `facts` tablosuna terfi edilir.

## Notlar

- Hassas ve kriz içerikli yorumlar SSS ile otomatik yanıtlanmaz; eskale edilir.

## Zamanlanmış koşumlar (persona_schedules)

PR-S5 migration'ı 5 **şablon** schedule seed'ler (`enabled=false`, placeholder `owner_user_id`).

Kurulum:
1. `persona_schedules` satırında `owner_user_id` değerini gerçek `auth.users` UUID'niz ile güncelleyin.
2. Portal Schedules sayfasından ilgili kaydı **enable** edin.
3. `next_fire_at` başlangıçta NULL olabilir; `portal/api/lib/schedulerTick.ts` ilk tetiklemede `computeNextFire` ile hesaplar.

Şablonlar aktif bırakılmamalı — placeholder owner ile `enabled=true` scheduler'ın sahte kullanıcıya `run_request` üretmesine yol açar.
