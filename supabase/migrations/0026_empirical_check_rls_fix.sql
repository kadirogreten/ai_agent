-- 0026_empirical_check_rls_fix.sql
-- 0025'teki ecr_service policy'sinde WITH CHECK yoktu; INSERT engelleniyor.
-- Service role key zaten RLS bypass yapar (Supabase JS), ama policy
-- yanlış yapılandırıldığında PostgREST FORCE_RLS varsayılanı altında
-- yine de engelleyebilir.
--
-- Çözüm: ecr_service policy'sini hem USING hem WITH CHECK true ile yeniden yaz.

DROP POLICY IF EXISTS ecr_service ON public.empirical_check_results;
CREATE POLICY ecr_service ON public.empirical_check_results
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- Authenticated kullanıcılar zaten okuyabiliyor (ecr_select). Script çoğunlukla
-- service role ile çalışacak ama lokal geliştirmede (user'ın .env'inde service
-- key olmayabilir) authenticated INSERT'e de izin veriyoruz — bu tablonun
-- içeriği yalnız ölçüm/sağlık verisi, güvenlik açısından düşük risk.
CREATE POLICY ecr_insert_authenticated ON public.empirical_check_results
  FOR INSERT TO authenticated
  WITH CHECK (true);

GRANT INSERT ON TABLE public.empirical_check_results TO authenticated;

-- Hata mesajındaki "violates row-level security" sebebi: service_role JWT'sinin
-- header'da geçtiğinden emin ol — Supabase JS client createClient(url, key, ...)
-- ikinci parametre service role key OLMALI, anon key değil.
