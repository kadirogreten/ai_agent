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

## PR-S7 — Meta OAuth + credential (platform-agnostik)

### Canlı inbox öncesi D0 zorunlu

**D0a + D0b + D0c** merge edilmeden gerçek inbox / `SOCIAL_API_MODE=live` açılmaz. D0b tek başına yeterli değildir — taint adım sınırında temizlendiğinden adımlar-arası injection savunması Verifier rubriği + R2/R3 insan onayına dayanır.

### Ortam değişkenleri

| Değişken | Nerede | Açıklama |
|----------|--------|----------|
| `SOCIAL_TOKEN_ENC_KEY` | Portal API + CLI worker | 32 byte base64 AES-256-GCM anahtarı |
| `META_APP_ID` / `META_APP_SECRET` | Portal API | Meta Developer uygulaması |
| `META_OAUTH_REDIRECT_URI` | Portal API | `https://<portal>/api/social/meta/oauth/callback` |
| `PORTAL_PUBLIC_URL` | Portal API | OAuth sonrası yönlendirme |
| `META_ACCESS_TOKEN` | CLI (fallback) | DB kaydı yoksa mock/demo MCP |
| `SOCIAL_API_MODE=demo` | CLI + meta-social-mcp | Graph çağrısı yok, deterministik demo |
| `META_PAGE_ID` | meta-social-mcp | Canlı Facebook sayfa yayını (App Review sonrası) |
| `X_APP_ID` / `X_APP_SECRET` | Portal API | X Developer uygulaması (PR-S8-X) |
| `X_OAUTH_REDIRECT_URI` | Portal API | `https://<portal>/api/social/x/oauth/callback` |
| `X_ACCESS_TOKEN` | CLI (fallback) | DB kaydı yoksa X API |

### Akış

1. Portal → **Sosyal hesaplar** → Meta **Bağla** → `user_social_accounts` (ciphertext, düz token yok).
2. CLI `CredentialResolver`: `RUN_OWNER_USER_ID` + `platform=meta` → decrypt veya `META_ACCESS_TOKEN` env.
3. `credentialRefreshTick` (cron): `expires_at` yakın Meta token'ları yeniler.

### Token sızıntısı guardrail

Token'lar **araç argümanı değil** — `McpClient` Authorization header. Log / `run_outputs` / `action_detail` / `tool_invocations` / `approval_queue` içinde düz metin token yazılmaz.

Doğrulama: `scripts/check-token-leakage.sh`

### Meta App Review checklist

- `pages_manage_posts`, `instagram_content_publish`, `ads_management`
- OAuth redirect URI production + preview ortamlarında kayıtlı
- App Review onayı öncesi `SOCIAL_API_MODE=demo` ile uçtan uca test
