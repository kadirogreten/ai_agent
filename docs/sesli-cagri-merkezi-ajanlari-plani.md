# Sesli Çağrı Merkezi Ajanları — Mimari, PR Planı ve Prompt Paketi

**Tarih:** 2026-06-14
**Hedef:** Çağrı merkezleri için **gerçek zamanlı konuşan (sesli) AI ajanları** kuran, sektör-agnostik ama önce **hukuk (icra takibi)** ve **bankacılık (gecikmiş borç tahsilatı)** ihtiyaçlarını karşılayan; gelen aramaları yanıtlayan, giden aramaları (icra/tahsilat) yürüten, ödeme durumu sorgulayan, ödeme sözü/planı kaydeden ve gerektiğinde insana eskale eden bir platform.

**Backend:** ASP.NET Core (.NET 8). **UI:** React + Tailwind (mevcut `portal/` ile aynı stack; ayrı `console/` uygulaması da olabilir). **Yönetişim deseni:** mevcut repodaki RiskGate + onay kuyruğu + audit zinciri (bkz. `docs/otomasyon-plani-ve-sonnet-promptlari.md`) sesli dünyaya taşınır.

> Bu doküman, mevcut "metin üreten ajan" omurgasının (LLM router, ToolExecutor, RiskGate, operations loop) üzerine **ses + telefon + gerçek-zamanlı diyalog** katmanını ekler. Hiçbir mevcut bileşen atılmaz; konuşma araç çağrıları aynı yönetişim hattından (RiskGate → onay → audit → compensation) geçer.
