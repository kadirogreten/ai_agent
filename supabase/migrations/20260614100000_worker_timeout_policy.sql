-- Dogfood fix: worker.run_timeout_ms policy seed.
-- Sorun: runRequestWorker dotnet process timeout'u 120 sn idi; canlıda web-search koşuları
--        bu limiti aşıp fail oluyordu. Policy okuyarak 600 sn'ye çıkarıldı.
--
-- Adlandırma: tarih-damgalı düzen.
-- Desen: 20260611210000_memory_promote_drift.sql (policy_settings seed + WHERE NOT EXISTS).

INSERT INTO public.policy_settings (owner_user_id, key, value, description)
SELECT NULL, 'worker.run_timeout_ms', '600000'::jsonb,
  'runRequestWorker dotnet process timeout (ms). Varsayılan 600000 (10 dk). ' ||
  'Web-search ve LLM koşuları uzun sürebilir; 120 sn''lik eski sabit canlıda fail üretiyordu.'
WHERE NOT EXISTS (
  SELECT 1 FROM public.policy_settings
  WHERE key = 'worker.run_timeout_ms' AND owner_user_id IS NULL
);
