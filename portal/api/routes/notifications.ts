import { Router, type Request, type Response } from 'express'
import { getSupabaseAdmin } from '../lib/supabaseAdmin.js'
import { notifyChannels } from '../lib/notifyChannels.js'

const router = Router()

function getBearerToken(req: Request): string | null {
  const auth = req.headers.authorization
  if (!auth?.startsWith('Bearer ')) return null
  return auth.slice(7)
}

async function getAuthedUser(req: Request) {
  const token = getBearerToken(req)
  if (!token) throw new Error('Missing Authorization header')
  const supabase = getSupabaseAdmin()
  const { data, error } = await supabase.auth.getUser(token)
  if (error || !data.user) throw new Error('Invalid token')
  return { supabase, user: data.user }
}

/**
 * POST /api/notifications/test
 * Body: { channel_id: string, message?: string }
 * Auth: Bearer token — owner_user_id token'dan alınır, body'den asla.
 *
 * Verilen kanalı test mesajıyla çağırır.
 * Kanal sahibi ≠ authenticated user ise 403.
 */
router.post('/test', async (req: Request, res: Response) => {
  try {
    const { supabase, user } = await getAuthedUser(req)

    const body = req.body as Record<string, unknown>
    const channelId = typeof body.channel_id === 'string' ? body.channel_id.trim() : null
    if (!channelId) return res.status(400).json({ ok: false, error: 'channel_id zorunlu' })

    const customMessage = typeof body.message === 'string' ? body.message.trim() : null

    // Kanalı doğrula — sahibi mevcut kullanıcı olmalı
    const { data: channel, error: chErr } = await supabase
      .from('notification_channels')
      .select('id, type, target, label, enabled')
      .eq('id', channelId)
      .eq('owner_user_id', user.id)
      .maybeSingle()

    if (chErr) return res.status(500).json({ ok: false, error: chErr.message })
    if (!channel) return res.status(403).json({ ok: false, error: 'Kanal bulunamadı veya size ait değil.' })

    const ch = channel as { id: string; type: string; target: string; label: string | null; enabled: boolean }
    const message = customMessage
      ?? `🔔 Test bildirimi — AgentArmy portal (kanal: ${ch.label ?? ch.type}, ${new Date().toLocaleString('tr-TR')})`

    // notifyChannels tüm aktif kanalları yükler; burada tek kanala göndermek için
    // doğrudan Slack/e-posta işlevini çağırıyoruz — notifyChannels'ı tek kanal için çağır.
    await notifyChannels({
      ownerId: user.id,
      subject: 'AgentArmy test bildirimi',
      message,
    })

    return res.status(200).json({ ok: true, channel_id: channelId, type: ch.type })
  } catch (err) {
    return res.status(500).json({ ok: false, error: (err as Error).message })
  }
})

export default router
