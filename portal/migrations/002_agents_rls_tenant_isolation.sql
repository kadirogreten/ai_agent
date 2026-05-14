-- IP0.4: agents tablosu tenant izolasyon düzeltmesi
-- Strateji §4.7: "Tenant Isolation Is Sacred"
--
-- Sistem ajanları: tenant_id IS NULL → tüm authenticated kullanıcılar okuyabilir
-- Tenant ajanları: tenant_id = auth.uid() → sadece sahibi erişebilir

-- 1. tenant_id (owner) kolonu ekle
ALTER TABLE agents
  ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES auth.users(id) ON DELETE CASCADE;

-- 2. Mevcut zayıf politikaları kaldır
DROP POLICY IF EXISTS agents_select_all ON agents;
DROP POLICY IF EXISTS agents_insert_authenticated ON agents;
DROP POLICY IF EXISTS agents_update_authenticated ON agents;
DROP POLICY IF EXISTS agents_delete_authenticated ON agents;

-- 3. Yeni politikalar
-- SELECT: sistem ajanları (NULL) herkese; tenant ajanları sadece sahibine
CREATE POLICY agents_select ON agents
  FOR SELECT USING (
    tenant_id IS NULL
    OR tenant_id = auth.uid()
  );

-- INSERT: authenticated kullanıcı kendi tenant_id'siyle
CREATE POLICY agents_insert ON agents
  FOR INSERT TO authenticated
  WITH CHECK (tenant_id = auth.uid());

-- UPDATE: sadece sahibi tenant ajanlarını güncelleyebilir
CREATE POLICY agents_update ON agents
  FOR UPDATE TO authenticated
  USING (tenant_id = auth.uid())
  WITH CHECK (tenant_id = auth.uid());

-- DELETE: sadece sahibi
CREATE POLICY agents_delete ON agents
  FOR DELETE TO authenticated
  USING (tenant_id = auth.uid());

-- 4. Service role tam erişim (worker sistem ajanlarını yönetmek için)
DROP POLICY IF EXISTS agents_service_role_all ON agents;
CREATE POLICY agents_service_role_all ON agents
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);
