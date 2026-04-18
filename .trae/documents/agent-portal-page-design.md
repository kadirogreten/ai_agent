# Sayfa Tasarım Dokümanı (Desktop-first)

## Global Styles
- Grid/spacing: 12 kolon, max-width 1200px, içerik padding 24px.
- Renkler: arka plan #0B1020; yüzey #111A33; çizgi #243056; vurgu #6EA8FF; başarı #22C55E; hata #EF4444.
- Tipografi: Başlık 24/20/18px; gövde 14/16px; monospace alanlar (log/json) için 13px.
- Butonlar: Primary (vurgu), Secondary (yüzey), Danger (kırmızı). Hover: +%6 parlaklık, focus ring 2px vurgu.
- Link: vurgu rengi, hover underline.
- Tablo: sticky header, zebra satır, satır hover highlight.

## 1) Giriş (/login)
### Layout
- Ortalanmış kart (max 420px), Flexbox ile dikey hizalama; mobilde tam genişlik.
### Meta
- Title: “Giriş | Agent Portal”
- Description: “Ajan çıktıları ve knowledge facts portalına giriş.”
- OG: title/description aynı, type=website.
### Page Structure
- Logo + kısa açıklama
- Form kartı
### Sections & Components
- Email input (type=email, required)
- Password input (type=password, required) + göster/gizle
- Primary: “Giriş Yap”
- Link: “Şifremi unuttum” → modal veya ayrı küçük form bloğu
- Durum alanı: hata metni (auth), loading spinner

## 2) Ana Panel (/app)
### Layout
- Üst bar + içerik alanı; içerikte 2 sütun: sol “Filtreler” (320px), sağ “Liste” (flex-grow). Küçük ekranlarda filtreler üstte accordion.
### Meta
- Title: “Ana Panel | Agent Portal”
- Description: “Runs, bundles ve knowledge facts listeleri.”
### Page Structure
- Topbar
- Sekmeler
- Filtre + Liste
### Sections & Components
- Topbar: ürün adı, global arama (opsiyonel aynı arama kutusu), kullanıcı menüsü (email, çıkış)
- Sekmeler: Runs / Bundles / Knowledge Facts
- Filtre Paneli (sekmeye göre değişir):
  - Tarih aralığı: başlangıç & bitiş (date-time picker)
  - Durum seçici (runs için): running/success/fail
  - Tags input (bundles/facts için): çoklu değer (chip)
  - Serbest metin arama: id/başlık
  - Butonlar: “Uygula”, “Temizle”
- Liste Alanı:
  - Runs: tablo kolonları: Durum, Başlık, Run ID, Başlangıç, Süre
  - Bundles: kolonlar: Ad, Bundle ID, Run ID, Tags, Oluşturma
  - Facts: kolonlar: Durum, Başlık, Tags, Kaynak, Güncelleme
  - Satır tıklama → ilgili detay route’u
- Fact Oluşturma (Ana Panel içinde):
  - Primary buton “Yeni Fact” → sağ drawer/modal
  - Form alanları: başlık, içerik textarea, tags chip input, durum select, kaynak türü select, kaynak id input (koşullu), confidence slider/number
  - Kaydet/İptal

## 3) Çıktı Detayı (Run/Bundle) (/app/runs/:runId ve /app/bundles/:bundleId)
### Layout
- Üstte breadcrumb + başlık; içerikte 2 kolon: sol metadata kartları, sağ içerik (log/json viewer). Grid + sticky metadata mümkün.
### Meta
- Title: “Run Detayı | Agent Portal” / “Bundle Detayı | Agent Portal”
- Description: “Seçilen çıktının detayları, ilişkiler ve ham içerik.”
### Page Structure
- Header (geri dönüş)
- Özet kartları
- İçerik görünümü
- İlişkili kayıtlar
### Sections & Components
- Header: geri butonu (Ana Panel’e), kopyala id
- Metadata:
  - Run: status badge, started/finished, duration, error_message (varsa)
  - Bundle: name, tags, created_at, run_id
- İçerik:
  - Run output_text: monospace, line-wrap toggle, “Kopyala”
  - Bundle payload_json: JSON tree viewer + “İndir JSON”
- İlişkiler:
  - “İlişkili Facts” listesi (mini tablo) → fact detaya git
  - Run sayfasında “İlişkili Bundles” listesi; Bundle sayfasında “Kaynak Run” linki

## 4) Knowledge Fact Detayı / Düzenleme (/app/facts/:factId)
### Layout
- Tek sayfa: üstte görüntüleme, altta düzenleme formu veya “Düzenle” ile edit moduna geçiş. Form bölümü 2 kolon (desktop), tek kolon (mobile).
### Meta
- Title: “Fact Detayı | Agent Portal”
- Description: “Knowledge fact görüntüleme ve düzenleme.”
### Page Structure
- Header (geri, aksiyonlar)
- Görüntüleme kartı
- Düzenleme formu (edit mode)
### Sections & Components
- Header: geri, “Düzenle” toggle, Danger “Sil” (confirm modal)
- Görüntüleme: başlık, durum badge, tags, kaynak (run/bundle/manual), confidence, timestamps
- Edit form inputları:
  - Title (text, required)
  - Content (textarea, required)
  - State (select: draft/verified/rejected)
  - Tags (chip input)
  - Source type (select) + Source ID (conditional input)
  - Confidence (0–1 number)
  - Actions: Kaydet, İptal

## Interaction & Responsive Notes
- Tüm listelerde: loading skeleton, empty state, hata banner.
- Detay sayfalarında: uzun içeriklerde sanal kaydırma opsiyonel; min gereksinim olarak katlanabilir alan.
- Animasyon: modal/drawer 150–200ms ease-out, focus trap ve ESC ile kapatma.
