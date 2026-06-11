import { Router, type Request, type Response } from 'express'
import { getSupabaseAdmin } from '../lib/supabaseAdmin.js'
import { getPolicy } from '../lib/policyReader.js'

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

// POST /api/operations — yeni operasyon oluştur
// owner_user_id body'den değil, auth token'dan gelir (commit 42ca135 deseni).
router.post('/', async (req: Request, res: Response) => {
  try {
    const { supabase, user } = await getAuthedUser(req)
    const body = req.body as Record<string, unknown>

    const goal_text        = typeof body.goal_text === 'string' ? body.goal_text.trim() : null
    const domain_pack      = typeof body.domain_pack === 'string' ? body.domain_pack.trim() : null
    const persona          = typeof body.persona === 'string' ? body.persona.trim() : null
    const model            = typeof body.model === 'string' ? body.model.trim() : null
    const risk             = typeof body.risk === 'string' ? body.risk : 'R1'
    const max_steps        = typeof body.max_steps === 'number' ? body.max_steps : 10
    const cooldown_minutes = typeof body.cooldown_minutes === 'number' ? body.cooldown_minutes : 30
    const intent_json      = (body.intent_json != null && typeof body.intent_json === 'object')
      ? body.intent_json as Record<string, unknown>
      : null

    if (!goal_text)   return res.status(400).json({ error: 'goal_text zorunlu' })
    if (!domain_pack) return res.status(400).json({ error: 'domain_pack zorunlu' })
    if (!['R0','R1','R2','R3'].includes(risk)) return res.status(400).json({ error: 'Geçersiz risk seviyesi' })

    // PR9: intent sözleşmesini policy_settings'teki şemadan oku; required alanları dinamik kontrol et.
    const schema = await getPolicy<{ required?: string[] }>(
      supabase, null, 'intent.contract_schema', { required: ['beneficiary', 'success_criteria'] }
    )
    const requiredFields = schema?.required ?? ['beneficiary', 'success_criteria']
    const missingField = requiredFields.find(
      (f) => !intent_json || intent_json[f] == null || intent_json[f] === ''
    )
    if (missingField) {
      return res.status(400).json({
        error: `intent_json.${missingField} zorunlu`,
        required: requiredFields,
      })
    }

    const { data, error } = await supabase
      .from('operations')
      .insert({
        owner_user_id: user.id,
        goal_text,
        domain_pack,
        persona,
        model,
        risk,
        max_steps,
        cooldown_minutes,
        intent_json,
        status:     'active',
        step_count: 0,
      })
      .select('id, status, goal_text, domain_pack, created_at')
      .single()

    if (error) throw error
    return res.status(201).json(data)
  } catch (e) {
    const err = e as Error
    if (err.message === 'Missing Authorization header') return res.status(401).json({ error: err.message })
    if (err.message === 'Invalid token')               return res.status(401).json({ error: err.message })
    console.error('[operations POST]', err)
    return res.status(500).json({ error: err.message })
  }
})

// GET /api/operations — kullanıcının operasyonlarını listele
router.get('/', async (req: Request, res: Response) => {
  try {
    const { supabase, user } = await getAuthedUser(req)

    const status = typeof req.query.status === 'string' ? req.query.status : null

    let query = supabase
      .from('operations')
      .select('id, goal_text, domain_pack, status, risk, step_count, max_steps, cooldown_minutes, last_tick_at, escalation_reason, created_at, updated_at')
      .eq('owner_user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(50)

    if (status) query = query.eq('status', status) as typeof query

    const { data, error } = await query
    if (error) throw error
    return res.json(data ?? [])
  } catch (e) {
    const err = e as Error
    if (err.message === 'Missing Authorization header') return res.status(401).json({ error: err.message })
    if (err.message === 'Invalid token')               return res.status(401).json({ error: err.message })
    return res.status(500).json({ error: (e as Error).message })
  }
})

// GET /api/operations/:id/events — operasyon event'lerini listele
router.get('/:id/events', async (req: Request, res: Response) => {
  try {
    const { supabase, user } = await getAuthedUser(req)
    const operationId = req.params.id

    // Önce operasyonun sahibini doğrula
    const { data: op, error: opErr } = await supabase
      .from('operations')
      .select('id')
      .eq('id', operationId)
      .eq('owner_user_id', user.id)
      .maybeSingle()

    if (opErr) throw opErr
    if (!op)   return res.status(404).json({ error: 'Operasyon bulunamadı' })

    const { data, error } = await supabase
      .from('operation_events')
      .select('id, kind, payload, created_at')
      .eq('operation_id', operationId)
      .order('created_at', { ascending: false })
      .limit(100)

    if (error) throw error
    return res.json(data ?? [])
  } catch (e) {
    const err = e as Error
    if (err.message === 'Missing Authorization header') return res.status(401).json({ error: err.message })
    if (err.message === 'Invalid token')               return res.status(401).json({ error: err.message })
    return res.status(500).json({ error: (e as Error).message })
  }
})

export default router
