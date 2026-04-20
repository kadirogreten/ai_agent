# Sayfa Tasarım Dokümanı (Desktop-first)

## Global Styles
- Layout: 12 kolon grid, max-width 1200px, sayfa padding 24px, kart iç padding 16px.
- Renkler: arka plan #0B1020; yüzey #111A33; çizgi #243056; vurgu #6EA8FF; başarı #22C55E; hata #EF4444.
- Tipografi: H1 24px/600, H2 18px/600, gövde 14–16px; yardımcı metin 12px.
- Form: input/textarea 40px yükseklik (textarea auto-grow), focus ring 2px vurgu, hata durumunda kırmızı border + mesaj.
- Buton: Primary (vurgu), Secondary (yüzey), Danger (kırmızı); hover: +%6 parlaklık.
- Tablo: sticky header, satır hover highlight, boş durum kartı.

## 1) Ajanlar (/agents)
### Layout
- Üstte sayfa başlığı; altında iki kolon: sol “Filtre/Arama” (320px), sağ “Liste” (kalan alan). Dar ekranlarda filtre alanı üstte accordion.
### Meta Information
- Title: “Ajanlar | Portal”
- Description: “Ajan envanterini listele, ara ve düzenle.”
- OG: title/description aynı, type=website.
### Page Structure
- Header (başlık + aksiyon)
- Filtre/Arama paneli
- Liste tablosu
### Sections & Components
- Header:
  - Sol: “Ajanlar” başlığı + kısa açıklama
  - Sağ: Primary “Yeni Ajan” → /agents/new
- Filtre/Arama paneli:
  - Arama input’u: placeholder “Ad veya kod ara”
  - Secondary: “Temizle”
- Liste tablosu:
  - Kolonlar: Ad, Kod, Açıklama (truncate), Yetenekler (chip sayısı), Güncellenme, Aksiyon
  - Satır tıklama: /agents/:agentId/edit
  - Aksiyon hücresi: Secondary “Düzenle”
- Durumlar:
  - Loading: skeleton satırlar
  - Empty: “Henüz ajan yok” + “Yeni Ajan” CTA
  - Error: banner + “Tekrar dene”

## 2) Ajan Oluştur / Düzenle (/agents/new, /agents/:agentId/edit)
### Layout
- Üstte breadcrumb/geri; içerikte tek sütun form (max 760px). Desktop’ta bazı alanlar 2 kolon (Ad | Kod).
### Meta Information
- Title: “Ajan Oluştur | Portal” / “Ajan Düzenle | Portal”
- Description: “Ajan bilgilerini kaydet.”
- OG: title/description aynı.
### Page Structure
- Header (geri + başlık)
- Form kartı
- Alt aksiyon barı
### Sections & Components
- Header:
  - Geri butonu → /agents
  - Başlık: “Yeni Ajan” veya “Ajanı Düzenle”
- Form alanları:
  - Ajan adı (text, required)
  - Ajan kodu (text, required)
    - Yardımcı metin: “Kod benzersiz olmalı (örn: SALES_ASSISTANT)”
  - Açıklama (textarea, opsiyonel)
  - “Neler yapar” / Yetenekler (çoklu değer):
    - Chip input + “Ekle” (Enter ile ekleme)
    - Chip üzerinde kaldırma (x)
- Doğrulama ve hata gösterimi:
  - Zorunlu alanlar boşsa alan altı mesaj
  - Kod benzersiz değilse inline hata + alanı vurgula
- Alt aksiyonlar:
  - Primary “Kaydet” (loading state)
  - Secondary “İptal” → /agents

## Interaction Notes
- Kaydet sonrası: toast “Kaydedildi” ve /agents’e yönlendirme.
- Formdan ayrılma: değişiklik varsa “Kaydedilmemiş değişiklikler” onayı (minimum: tarayıcı confirm).