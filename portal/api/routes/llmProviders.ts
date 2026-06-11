import { Router, type Request, type Response } from 'express'
import { getSupabaseAdmin } from '../lib/supabaseAdmin.js'

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

// PR10: Admin kapısı — yalnızca ADMIN_USER_IDS listesindeki kullanıcılar yazma yapabilir.
// Tek kullanıcılı ortamda ADMIN_USER_IDS boşsa herkes yazabilir (geliştirme kolaylığı için).
function getAdminIds(): string[] {
  return (process.env.ADMIN_USER_IDS ?? '').split(',').map((s) => s.trim()).filter(Boolean)
}

function assertAdmin(userId: string, res: Response): boolean {
  const adminIds = getAdminIds()
  if (adminIds.length > 0 && !adminIds.includes(userId)) {
    res.status(403).json({ error: 'Yalnızca admin kullanıcılar model ayarlarını değiştirebilir.' })
    return false
  }
  return true
}

/**
 * GET /api/llm-providers
 * Authenticated: provider listesini döner (api_key_env adı görünür, anahtar değil).
 */
router.get('/', async (req: Request, res: Response) => {
  try {
    const { supabase } = await getAuthedUser(req)

    const { data, error } = await supabase
      .from('llm_providers')
      .select('id, slug, display_name, api_base, api_key_env, model_id, kind, tier, max_decision_risk, enabled, is_default_for, created_at')
      .order('tier', { ascending: true })

    if (error) throw error
    return res.status(200).json(data ?? [])
  } catch (e) {
    const err = e as Error
    if (err.message === 'Missing Authorization header') return res.status(401).json({ error: err.message })
    if (err.message === 'Invalid token')               return res.status(401).json({ error: err.message })
    return res.status(500).json({ error: err.message })
  }
})

/**
 * PATCH /api/llm-providers/:id
 * Admin only. enabled ve is_default_for güncellenir.
 * is_default_for güncelleme: verilen purpose için önce diğer provider'lardan kaldırılır
 * (tek varsayılan per purpose), sonra bu provider'a eklenir.
 */
router.patch('/:id', async (req: Request, res: Response) => {
  try {
    const { user } = await getAuthedUser(req)
    if (!assertAdmin(user.id, res)) return res.status(403).end()

    const supabase = getSupabaseAdmin()
    const providerId = req.params.id
    const body       = req.body as Record<string, unknown>

    // Desteklenen alanlar: enabled ve is_default_for
    const updates: Record<string, unknown> = {}

    if (typeof body.enabled === 'boolean') {
      updates.enabled = body.enabled
    }

    if (Array.isArray(body.is_default_for)) {
      const purposes = (body.is_default_for as unknown[]).filter((p) => typeof p === 'string') as string[]

      // Atanan her purpose için: diğer provider'lardan bu purpose'u temizle
      for (const purpose of purposes) {
        const { data: others } = await supabase
          .from('llm_providers')
          .select('id, is_default_for')
          .neq('id', providerId)

        for (const other of (others ?? []) as { id: string; is_default_for: string[] }[]) {
          if (other.is_default_for.includes(purpose)) {
            const cleaned = other.is_default_for.filter((p) => p !== purpose)
            await supabase
              .from('llm_providers')
              .update({ is_default_for: cleaned })
              .eq('id', other.id)
          }
        }
      }

      updates.is_default_for = purposes
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: 'Güncellenecek alan yok (enabled veya is_default_for bekleniyor)' })
    }

    const { data, error } = await supabase
      .from('llm_providers')
      .update(updates)
      .eq('id', providerId)
      .select()
      .single()

    if (error) throw error
    return res.status(200).json(data)
  } catch (e) {
    const err = e as Error
    if (err.message === 'Missing Authorization header') return res.status(401).json({ error: err.message })
    if (err.message === 'Invalid token')               return res.status(401).json({ error: err.message })
    return res.status(500).json({ error: err.message })
  }
})

export default router
