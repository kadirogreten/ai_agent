-- Portal tools hattı: run_requests.tools kolonu.
-- RunWizardPage'den girilen 'Araç izinleri' metni (PR2'deki ToolPermissions grameri,
-- ör. "tools: web_scrape; max_calls: 3") bu kolona yazılır, worker CLI'a
-- --tools "..." olarak iletir.
--
-- Idempotent (ADD COLUMN IF NOT EXISTS). Mevcut satırlar NULL kalır → worker
-- pass-through "tools yoksa --tools'u CLI'a hiç ekleme" mantığıyla bozulmaz.

ALTER TABLE public.run_requests
  ADD COLUMN IF NOT EXISTS tools TEXT;

COMMENT ON COLUMN public.run_requests.tools IS
  'Görev için araç izinleri (PR2 ToolPermissions grameri). Örn: "tools: web_scrape, file_store; max_calls: 3". NULL ise CLI varsayılanı (araç yok) uygulanır.';
