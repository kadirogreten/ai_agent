import { loadPortalEnv } from './loadPortalEnv.js'
import { createClient } from '@supabase/supabase-js'

loadPortalEnv()
const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

const cmd = process.argv[2] ?? 'show'
const opId = process.argv[3] ?? '25c356c1-9f71-4761-996c-c8908d744b07'

if (cmd === 'unblock' && opId) {
  const { error } = await sb
    .from('operations')
    .update({ cooldown_minutes: 0, last_tick_at: null, updated_at: new Date().toISOString() })
    .eq('id', opId)
  console.log('unblock', error?.message ?? 'ok — cooldown sıfırlandı, sonraki tick işler')
  process.exit(error ? 1 : 0)
}

const { data: op } = await sb
  .from('operations')
  .select('id, status, step_count, max_steps, context_json, updated_at')
  .eq('id', opId)
  .maybeSingle()

console.log('operation:', op)

const { data: runs } = await sb
  .from('run_requests')
  .select('id, status, mode, risk, created_at, answers_json')
  .eq('operation_id', opId)
  .order('created_at')

console.log(
  'runs:',
  runs?.map((r) => ({
    id: r.id,
    status: r.status,
    risk: r.risk,
    playbook: (r.answers_json as Record<string, unknown>)?.playbookId,
  })),
)

const { data: pending } = await sb
  .from('run_requests')
  .select('id, status, operation_id')
  .eq('status', 'waiting_approval')
  .order('created_at', { ascending: false })
  .limit(5)

console.log('waiting_approval:', pending)
