import { loadPortalEnv } from './loadPortalEnv.js'
import { createClient } from '@supabase/supabase-js'

loadPortalEnv()
const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

const cmd = process.argv[2] ?? 'list'
const id = process.argv[3] ?? ''

if (cmd === 'reset' && id) {
  await sb.from('approval_queue').delete().eq('run_request_id', id)
  const { error } = await sb.from('run_requests').update({
    status: 'pending', started_at: null, updated_at: new Date().toISOString(),
  }).eq('id', id)
  console.log('reset', error?.message ?? 'ok')
  process.exit(error ? 1 : 0)
}

const prefix = id || (cmd !== 'reset' ? cmd : '')
const { data: recent } = await sb
  .from('run_requests')
  .select('id,status,mode,risk,allow_high_risk,error_message,created_at')
  .order('created_at', { ascending: false })
  .limit(10)

console.log('recent:', recent)

if (prefix) {
  const { data } = await sb
    .from('run_requests')
    .select('*')
    .ilike('id', `${prefix}%`)
    .limit(3)
  console.log('match:', data)
}
