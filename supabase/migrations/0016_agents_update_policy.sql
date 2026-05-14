-- IP0.4b: agents UPDATE/DELETE policy düzeltme
-- Sorun: 0011'de UPDATE USING(tenant_id = auth.uid()) olarak daraltıldı.
-- Bu nedenle tenant_id=NULL olan sistem ajanları portal'dan güncellenemiyor
-- (UPDATE sessizce 0 satır etkiliyor, RLS hata fırlatmıyor).
--
-- Düzeltme: Authenticated kullanıcı hem sistem ajanlarını (tenant_id IS NULL)
-- hem kendi tenant ajanlarını güncelleyebilir.
-- TODO: Platform admin role eklenince sistem ajanları sadece admin'e kısıtlanacak.

DROP POLICY IF EXISTS agents_update_own ON public.agents;
CREATE POLICY agents_update_own ON public.agents
  FOR UPDATE TO authenticated
  USING  (tenant_id IS NULL OR tenant_id = auth.uid())
  WITH CHECK (tenant_id IS NULL OR tenant_id = auth.uid());

DROP POLICY IF EXISTS agents_delete_own ON public.agents;
CREATE POLICY agents_delete_own ON public.agents
  FOR DELETE TO authenticated
  USING (tenant_id IS NULL OR tenant_id = auth.uid());

-- INSERT: kendi tenant_id'siyle veya sistem ajanı olarak ekleyebilir
-- (0011'deki INSERT policy çok kısıtlıydı: sadece tenant_id=auth.uid() kabul ediyordu)
DROP POLICY IF EXISTS agents_insert_own ON public.agents;
CREATE POLICY agents_insert_own ON public.agents
  FOR INSERT TO authenticated
  WITH CHECK (tenant_id IS NULL OR tenant_id = auth.uid());
