-- PR-S7b: Meta live MCP + compensation + sosyal araç compensation güncellemeleri.

-- meta-social MCP endpoint: meta-social-mcp.ts (aynı port, gerçek Graph + demo fallback)
-- NOT: mcp_servers'ta updated_at kolonu YOK (20260614110000 şeması) — SET listesine ekleme.
UPDATE public.mcp_servers
SET
  display_name = 'Meta Social (Graph API)',
  endpoint     = 'http://127.0.0.1:3847/mcp'
WHERE slug = 'meta-social' AND owner_user_id IS NULL;

-- post_publish → post_delete compensation
UPDATE public.tools
SET
  compensation = 'post_delete',
  description  = 'Onaylı post taslağını Meta Graph API üzerinden yayınlar (MCP post_publish). R2 — insan onayı gerekir.',
  updated_at   = now()
WHERE slug = 'meta-social__post_publish';

-- social_reply_send → reply_delete compensation (builtin araç)
UPDATE public.tools
SET
  compensation = 'reply_delete',
  description  = 'Onaylı yanıt metnini ilgili yorum/DM öğesine gönderir. R2 — insan onayı gerekir. Compensation: reply_delete.',
  updated_at   = now()
WHERE slug = 'social_reply_send';

NOTIFY pgrst, 'reload schema';
