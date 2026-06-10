-- Güvenlik kilidi 3: Bildirim kanalları.
-- approval_queue'ya yeni kayıt düşünce Slack/e-posta bildirimi.
-- target alanı hassas (webhook URL, e-posta) — audit log'a YAZILMAZ (NotificationDispatcher bunu garantiler).
--
-- Adlandırma: 20260609* tarih-damgalı düzen.
-- RLS deseni: 004_approval_queue.sql'i izler.

CREATE TABLE IF NOT EXISTS public.notification_channels (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id  UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  type           TEXT        NOT NULL CHECK (type IN ('slack_webhook','email')),
  target         TEXT        NOT NULL,   -- webhook URL veya e-posta; audit/log'a yazılmaz
  label          TEXT,                  -- kullanıcıya gösterilen etiket (ör. "#tedarik-kanal")
  enabled        BOOLEAN     NOT NULL DEFAULT true,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE  public.notification_channels IS
  'Onay bekleyenler için bildirim kanalları. target hassas veridir; audit log''a yazdırılmaz.';
COMMENT ON COLUMN public.notification_channels.target IS
  'Slack webhook URL veya e-posta adresi. Hassas — log''a basılmaz.';

-- ── RLS ─────────────────────────────────────────────────────────────────────
ALTER TABLE public.notification_channels ENABLE ROW LEVEL SECURITY;

CREATE POLICY nc_select_own ON public.notification_channels
  FOR SELECT TO authenticated
  USING (owner_user_id = auth.uid());

CREATE POLICY nc_insert_own ON public.notification_channels
  FOR INSERT TO authenticated
  WITH CHECK (owner_user_id = auth.uid());

CREATE POLICY nc_update_own ON public.notification_channels
  FOR UPDATE TO authenticated
  USING (owner_user_id = auth.uid())
  WITH CHECK (owner_user_id = auth.uid());

CREATE POLICY nc_delete_own ON public.notification_channels
  FOR DELETE TO authenticated
  USING (owner_user_id = auth.uid());

CREATE POLICY nc_service_role_all ON public.notification_channels
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.notification_channels TO authenticated;
GRANT ALL ON TABLE public.notification_channels TO service_role;

-- ── İndeksler ────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_nc_owner_enabled
  ON public.notification_channels(owner_user_id, enabled)
  WHERE enabled = true;
