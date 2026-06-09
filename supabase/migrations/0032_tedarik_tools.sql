-- Tedarik otomasyonu — ŞEMA değişikliği (içerik yok).
--
-- DB-first ilke: araç KAYITLARI (purchase_order, stock_check, cargo_track gibi) statik seed
-- ile değil, portal Araçlar sayfasından dinamik oluşturulur. Bu migration yalnız bunu mümkün
-- kılan şema değişikliğini yapar: tools.category CHECK kısıtına 'commerce' ve 'logistics'
-- kategorilerini ekler.
--
-- Not: Araçların ÇALIŞTIRILMASI CLI ToolExecutor (kod) ile olur; DB satırı yalnız portal
-- listeleme + agent_tools ilişkilendirmesi içindir.

ALTER TABLE public.tools DROP CONSTRAINT IF EXISTS tools_category_check;
ALTER TABLE public.tools
  ADD CONSTRAINT tools_category_check
  CHECK (category IN ('search','communication','calendar','storage','code','data','utility','commerce','logistics'));
