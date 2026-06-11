/**
 * Paylaşılan bildirim helper'ı.
 * RiskGate (C# tarafı doğrudan HTTP yapar) ve runRequestWorker (R2 approval) bu modülü kullanır.
 * notification_channels tablosundan aktif kanalları okur; Slack webhook + Resend e-posta gönderir.
 *
 * Güvenlik notu: channel.target hassas (webhook URL / e-posta) — log'a YAZILMAZ.
 * Kapsam notu: CLI RiskGate bildirimi zaten C# NotificationDispatcher'da.
 * Bu modül yalnız Node.js (worker / tick) yolunu kapsar.
 */
import { getSupabaseAdmin } from './supabaseAdmin.js'

type Channel = {
  type: 'slack_webhook' | 'email'
  target: string
  label: string | null
}

function log(msg: string, meta?: Record<string, unknown>) {
  const ts = new Date().toISOString()
  if (!meta) { console.log(`[notifyChannels ${ts}] ${msg}`); return }
  console.log(`[notifyChannels ${ts}] ${msg}`, JSON.stringify(meta))
}

async function loadChannels(ownerId: string): Promise<Channel[]> {
  const supabase = getSupabaseAdmin()
  const { data, error } = await supabase
    .from('notification_channels')
    .select('type, target, label')
    .eq('owner_user_id', ownerId)
    .eq('enabled', true)

  if (error) {
    log('Kanal listesi okunamadı', { error: error.message })
    return []
  }
  return (data ?? []) as Channel[]
}

async function sendSlack(webhookUrl: string, message: string): Promise<void> {
  const resp = await fetch(webhookUrl, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ text: message }),
  })
  if (!resp.ok) {
    const body = await resp.text()
    log('Slack yanıtı başarısız', { status: resp.status, body: body.slice(0, 100) })
  }
}

async function sendEmail(
  to: string,
  subject: string,
  text: string,
  html: string,
): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) {
    log('RESEND_API_KEY tanımlı değil; e-posta atlanıyor')
    return
  }
  const from = process.env.RESEND_FROM_EMAIL ?? 'noreply@agentarmy.app'
  const resp = await fetch('https://api.resend.com/emails', {
    method:  'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type':  'application/json',
    },
    body: JSON.stringify({ from, to: [to], subject, text, html }),
  })
  if (!resp.ok) {
    const body = await resp.text()
    log('Resend yanıtı başarısız', { status: resp.status, body: body.slice(0, 100) })
  }
}

/**
 * Sahibin aktif bildirim kanallarına mesaj gönderir.
 * Kanal yoksa veya gönderim başarısız olursa sessizce devam eder.
 */
export async function notifyChannels(opts: {
  ownerId:  string
  subject:  string
  message:  string
  html?:    string
}): Promise<void> {
  const channels = await loadChannels(opts.ownerId)
  if (channels.length === 0) return

  const html = opts.html ?? `<p>${opts.message.replace(/\n/g, '<br/>')}</p>`

  for (const ch of channels) {
    try {
      if (ch.type === 'slack_webhook') {
        await sendSlack(ch.target, opts.message)
        log('Slack gönderildi', { label: ch.label ?? '?' })
      } else if (ch.type === 'email') {
        await sendEmail(ch.target, opts.subject, opts.message, html)
        log('E-posta gönderildi', { label: ch.label ?? '?' })
      }
    } catch (e) {
      // target hassas — sadece type ve label logla
      log('Bildirim hatası', { type: ch.type, label: ch.label ?? '?', error: (e as Error).message })
    }
  }
}
