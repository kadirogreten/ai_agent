import { Router, type Request, type Response } from 'express'
import { getSupabaseAdmin } from '../lib/supabaseAdmin.js'

const router = Router()

function getBearerToken(req: Request) {
  const h = req.headers.authorization
  if (!h) return null
  const m = /^Bearer\s+(.+)$/.exec(h)
  return m?.[1] ?? null
}

async function getAuthedUser(req: Request) {
  const token = getBearerToken(req)
  if (!token) throw new Error('Missing Authorization header')
  const supabase = getSupabaseAdmin()
  const user = await supabase.auth.getUser(token)
  if (user.error || !user.data.user) throw new Error('Invalid token')
  return { supabase, user: user.data.user }
}

async function getOwnedJob(supabase: ReturnType<typeof getSupabaseAdmin>, ownerUserId: string, jobId: string) {
  const res = await supabase
    .from('run_requests')
    .select('*')
    .eq('id', jobId)
    .eq('owner_user_id', ownerUserId)
    .maybeSingle()
  if (res.error) throw res.error
  if (!res.data) throw new Error('Job not found')
  return res.data
}

function isSectorBuilderJob(answersJson: unknown): boolean {
  if (!answersJson || typeof answersJson !== 'object' || Array.isArray(answersJson)) return false
  return (answersJson as Record<string, unknown>).source === 'sector-builder'
}

function mergeSectorMetadata(existing: unknown, answers: Record<string, string>, phase?: string) {
  const base: Record<string, unknown> =
    existing && typeof existing === 'object' && !Array.isArray(existing)
      ? { ...(existing as Record<string, unknown>) }
      : {}
  for (const [k, v] of Object.entries(answers)) base[k] = v
  if (phase) base.phase = phase
  return base
}

// Review: /api/ceo/jobs/:id/review (ceo-iterate sözleşmesi) — SectorBuilderPage doğrudan kullanır.

// Diyalog tamamlandı → sector_factory operasyonu başlat
router.post('/jobs/:jobId/execute', async (req: Request, res: Response) => {
  try {
    const { supabase, user } = await getAuthedUser(req)
    const job = await getOwnedJob(supabase, user.id, req.params.jobId)

    if (!isSectorBuilderJob(job.answers_json)) {
      return res.status(400).json({ success: false, error: 'Bu iş sector-builder akışına ait değil' })
    }

    const answersJson = job.answers_json as Record<string, unknown>
    const sectorPrompt = typeof answersJson.sector_prompt === 'string'
      ? answersJson.sector_prompt
      : (job.request_text ?? '')

    const answerEntries = Object.entries(answersJson).filter(
      ([k]) => !['source', 'phase', 'sector_prompt', 'playbookId'].includes(k),
    )
    const summary = answerEntries
      .map(([q, a]) => `${q}: ${String(a)}`)
      .join('\n')
      .slice(0, 2000)

    const mergedAnswers = mergeSectorMetadata(job.answers_json, {}, 'execute')
    await supabase
      .from('run_requests')
      .update({ answers_json: mergedAnswers })
      .eq('id', job.id)

    const goalText = sectorPrompt + (summary ? `\n\nKullanıcı cevapları:\n${summary}` : '')

    const { data: op, error: opErr } = await supabase
      .from('operations')
      .insert({
        owner_user_id: user.id,
        goal_text: goalText,
        domain_pack: 'system',
        risk: 'R2',
        max_steps: 15,
        cooldown_minutes: 30,
        intent_json: {
          beneficiary: 'pazar ekibi',
          success_criteria: 'sektör paketi oluştu ve onaylandı',
        },
        context_json: {
          kind: 'sector_factory',
          sector_name: sectorPrompt.slice(0, 120),
          sector_job_id: job.id,
          sector_answers: mergedAnswers,
        },
        status: 'active',
        step_count: 0,
      })
      .select('id, status, goal_text, created_at')
      .single()

    if (opErr) throw opErr

    return res.status(201).json({ success: true, operationId: op.id, operation: op })
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e)
    if (message === 'Missing Authorization header' || message === 'Invalid token') {
      return res.status(401).json({ success: false, error: message })
    }
    return res.status(500).json({ success: false, error: message })
  }
})

router.get('/jobs/:jobId', async (req: Request, res: Response) => {
  try {
    const { supabase, user } = await getAuthedUser(req)
    const job = await getOwnedJob(supabase, user.id, req.params.jobId)
    return res.json({ success: true, job })
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e)
    return res.status(message.includes('token') ? 401 : 404).json({ success: false, error: message })
  }
})

export default router
