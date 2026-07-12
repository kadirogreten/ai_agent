/**
 * D4c — Public API v1 (API key auth). Kapalı doğar: public_api.enabled=false → 503.
 */
import { Router, type Request, type Response } from 'express'
import { getSupabaseAdmin } from '../lib/supabaseAdmin.js'
import { getPolicy } from '../lib/policyReader.js'
import {
  isApiKeyBearer,
  keyHasScope,
  verifyApiKey,
  type VerifiedApiKey,
} from '../lib/apiKeys.js'
import { checkPublicApiRateLimit } from '../lib/publicApiRateLimit.js'
import { applyPublicApiRiskFloor, isRiskLevel, type RiskLevel } from '../lib/publicApiRisk.js'
import { resolvePublicApiGate } from '../lib/publicApiGate.js'

const router = Router()

function getBearerToken(req: Request): string | null {
  const auth = req.headers.authorization
  if (!auth?.startsWith('Bearer ')) return null
  return auth.slice(7)
}

async function requireApiKey(req: Request, res: Response): Promise<VerifiedApiKey | null> {
  const token = getBearerToken(req)
  if (!token || !isApiKeyBearer(token)) {
    res.status(401).json({ error: 'Missing or invalid API key' })
    return null
  }
  const supabase = getSupabaseAdmin()
  const key = await verifyApiKey(supabase, token)
  if (!key) {
    res.status(401).json({ error: 'Invalid API key' })
    return null
  }
  return key
}

async function assertPublicApiEnabled(
  ownerUserId: string,
  res: Response,
): Promise<boolean> {
  const supabase = getSupabaseAdmin()
  const enabled = await getPolicy<boolean>(supabase, ownerUserId, 'public_api.enabled', false)
  const gate = resolvePublicApiGate(enabled)
  if (!gate.allowed) {
    res.status(gate.status!).json({ error: gate.error })
    return false
  }
  return true
}

async function assertRateLimit(key: VerifiedApiKey, res: Response): Promise<boolean> {
  const supabase = getSupabaseAdmin()
  const limit = await getPolicy<number>(
    supabase,
    key.ownerUserId,
    'public_api.rate_limit_per_minute',
    30,
  )
  if (!checkPublicApiRateLimit(key.id, Number(limit) || 30)) {
    res.status(429).json({ error: 'rate_limit_exceeded' })
    return false
  }
  return true
}

/**
 * Budget zorunlu: owner'da en az bir operation_budgets satırı olmalı;
 * consume_budget reddederse 429.
 */
async function assertBudget(ownerUserId: string, res: Response): Promise<boolean> {
  const supabase = getSupabaseAdmin()
  const { data: rows, error } = await supabase
    .from('operation_budgets')
    .select('scope')
    .eq('owner_user_id', ownerUserId)
    .limit(20)

  if (error) {
    console.error('[v1 budget]', error)
    res.status(500).json({ error: 'budget_check_failed' })
    return false
  }
  if (!rows?.length) {
    res.status(402).json({ error: 'budget_required', detail: 'operation_budgets satırı yok' })
    return false
  }

  const scope =
    rows.find((r) => r.scope === 'public_api')?.scope ??
    rows.find((r) => r.scope === 'global')?.scope ??
    rows[0]!.scope

  const { data: result, error: rpcErr } = await supabase.rpc('consume_budget', {
    p_owner: ownerUserId,
    p_scope: scope,
    p_amount: 0,
    p_calls: 1,
  })

  if (rpcErr) {
    console.error('[v1 consume_budget]', rpcErr)
    res.status(500).json({ error: 'budget_check_failed' })
    return false
  }

  const allowed = (result as { allowed?: boolean } | null)?.allowed === true
  if (!allowed) {
    res.status(429).json({
      error: 'budget_exceeded',
      detail: (result as { reason?: string })?.reason,
    })
    return false
  }
  return true
}

/** POST /api/v1/operations */
router.post('/operations', async (req: Request, res: Response) => {
  try {
    const key = await requireApiKey(req, res)
    if (!key) return
    if (!(await assertPublicApiEnabled(key.ownerUserId, res))) return
    if (!keyHasScope(key, 'operations:write')) {
      return res.status(403).json({ error: 'scope_required', scope: 'operations:write' })
    }
    if (!(await assertRateLimit(key, res))) return
    if (!(await assertBudget(key.ownerUserId, res))) return

    const body = req.body as Record<string, unknown>
    const goal_text = typeof body.goal_text === 'string' ? body.goal_text.trim() : null
    const domain_pack = typeof body.domain_pack === 'string' ? body.domain_pack.trim() : null
    const persona = typeof body.persona === 'string' ? body.persona.trim() : null
    const model = typeof body.model === 'string' ? body.model.trim() : null
    const requestedRisk: RiskLevel = isRiskLevel(body.risk) ? body.risk : 'R1'
    const max_steps = typeof body.max_steps === 'number' ? body.max_steps : 10
    const cooldown_minutes = typeof body.cooldown_minutes === 'number' ? body.cooldown_minutes : 30
    const intent_json =
      body.intent_json != null && typeof body.intent_json === 'object'
        ? (body.intent_json as Record<string, unknown>)
        : null

    if (!goal_text) return res.status(400).json({ error: 'goal_text zorunlu' })
    if (!domain_pack) return res.status(400).json({ error: 'domain_pack zorunlu' })

    const supabase = getSupabaseAdmin()
    const schema = await getPolicy<{ required?: string[] }>(
      supabase,
      null,
      'intent.contract_schema',
      { required: ['beneficiary', 'success_criteria'] },
    )
    const requiredFields = schema?.required ?? ['beneficiary', 'success_criteria']
    const missingField = requiredFields.find(
      (f) => !intent_json || intent_json[f] == null || intent_json[f] === '',
    )
    if (missingField) {
      return res.status(400).json({
        error: `intent_json.${missingField} zorunlu`,
        required: requiredFields,
      })
    }

    const risk = applyPublicApiRiskFloor(requestedRisk)
    const context_json = {
      source: 'public_api',
      api_key_id: key.id,
      requested_risk: requestedRisk,
    }

    const { data, error } = await supabase
      .from('operations')
      .insert({
        owner_user_id: key.ownerUserId,
        goal_text,
        domain_pack,
        persona,
        model,
        risk,
        max_steps,
        cooldown_minutes,
        intent_json,
        context_json,
        status: 'active',
        step_count: 0,
      })
      .select('id, status, goal_text, domain_pack, risk, created_at')
      .single()

    if (error) throw error
    return res.status(201).json(data)
  } catch (e) {
    console.error('[v1 POST operations]', e)
    return res.status(500).json({ error: (e as Error).message })
  }
})

/** GET /api/v1/operations/:id */
router.get('/operations/:id', async (req: Request, res: Response) => {
  try {
    const key = await requireApiKey(req, res)
    if (!key) return
    if (!(await assertPublicApiEnabled(key.ownerUserId, res))) return
    if (!keyHasScope(key, 'operations:read')) {
      return res.status(403).json({ error: 'scope_required', scope: 'operations:read' })
    }
    if (!(await assertRateLimit(key, res))) return

    const id = req.params.id
    const supabase = getSupabaseAdmin()
    const { data, error } = await supabase
      .from('operations')
      .select(
        'id, goal_text, domain_pack, status, risk, step_count, max_steps, escalation_reason, created_at, updated_at, context_json',
      )
      .eq('id', id)
      .eq('owner_user_id', key.ownerUserId)
      .maybeSingle()

    if (error) throw error
    if (!data) return res.status(404).json({ error: 'not_found' })
    return res.json(data)
  } catch (e) {
    console.error('[v1 GET operations]', e)
    return res.status(500).json({ error: (e as Error).message })
  }
})

export default router
