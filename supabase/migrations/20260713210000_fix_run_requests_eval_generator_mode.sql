-- FIX: run_requests.mode CHECK kısıtı 'eval_generator' değerini içermiyordu.
-- Sonuç: enqueueEvalGeneratorJob insert'i 23514 CHECK ihlaliyle sessizce başarısız
-- oluyor, otomatik eval hiç üretilmiyor, taslaklar eval_status=pending'de kalıyor
-- ve merge kapısı ("Onayla & Aktifleştir") açılmıyor.
--
-- 0003_run_requests.sql: mode IN ('run','bundle','ceo','ceo-iterate')
-- D2b (20260709180000) eval_generator_run_id kolonunu ekledi ama CHECK'i genişletmedi.
--
-- Not: runRequestWorker mode='eval_generator' job'ını processEvalGeneratorJob'a
-- yönlendiriyor; enqueue de bu mode ile insert ediyor. İkisi de mevcut, tek eksik CHECK.

ALTER TABLE public.run_requests
  DROP CONSTRAINT IF EXISTS run_requests_mode_check;

ALTER TABLE public.run_requests
  ADD CONSTRAINT run_requests_mode_check
  CHECK (mode IN ('run','bundle','ceo','ceo-iterate','eval_generator'));
