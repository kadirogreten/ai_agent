/**
 * Operasyon döngüsü — DECIDE fazı prompt'u.
 * LLM'e gönderilecek system prompt ve JSON sözleşmesini tanımlar.
 * operationLoopTick.ts bu modülü import eder; prompt gömülü değildir.
 */

export const DECIDE_SYSTEM_PROMPT = `\
Sen bir otonom ajan operatörüsün. Aşağıdaki gözlem verisiyle bir sonraki aksiyonu seçeceksin.

## Karar kuralları
1. Eğer son çalıştırma başarılıysa ve hedef hâlâ eksikse → "continue" (aynı veya farklı playbook)
2. Eğer son çalıştırma başarısızsa → "retry" (en fazla 3 arka arkaya başarısızlıkta "escalate")
3. Eğer onay kuyruğu dolu (bekleyen onay var) → "wait_approval"
4. Eğer hedef tamamlandıysa → "done"
5. Eğer herhangi bir kısıt aşıldıysa (maliyet, hata sayısı, bilinmeyen durum) → "escalate"

## Çıktı formatı — SADECE geçerli JSON, başka hiçbir şey yazma
\`\`\`json
{
  "action":        "continue" | "retry" | "wait_approval" | "done" | "escalate",
  "next_playbook": "<slug veya null>",
  "next_topic":    "<LLM'e geçirilecek kısa görev metni veya null>",
  "reason":        "<Kararın gerekçesi, en fazla 120 karakter>"
}
\`\`\`

Kurallar:
- action "continue" veya "retry" ise next_playbook dolu olmalı.
- action "done", "wait_approval" veya "escalate" ise next_playbook null olmalı.
- reason her zaman dolu olmalı.
- JSON dışında HİÇBİR metin yazma; açıklama, başlık veya markdown blok işareti dahil.
`

export type DecideAction = 'continue' | 'retry' | 'wait_approval' | 'done' | 'escalate'

export interface DecideResponse {
  action:        DecideAction
  next_playbook: string | null
  next_topic:    string | null
  reason:        string
}

/** LLM çıktısını parse eder. Başarısız parse → null döner (tick escalate eder). */
export function parseDecideResponse(raw: string): DecideResponse | null {
  // Olası ```json ... ``` sarmalayıcıyı temizle (model kural dışı sarabilir).
  const cleaned = raw.replace(/```json\s*/gi, '').replace(/```/g, '').trim()
  try {
    const obj = JSON.parse(cleaned) as Partial<DecideResponse>
    const validActions: DecideAction[] = ['continue', 'retry', 'wait_approval', 'done', 'escalate']
    if (!obj.action || !validActions.includes(obj.action)) return null
    if (!obj.reason) return null
    return {
      action:        obj.action,
      next_playbook: obj.next_playbook ?? null,
      next_topic:    obj.next_topic    ?? null,
      reason:        obj.reason.slice(0, 240),
    }
  } catch {
    return null
  }
}

/** OBSERVE gözlem verisini user mesajına dönüştürür. */
export function buildDecideUserMessage(obs: {
  goalText:          string
  lastRunStatus:     string | null
  lastVerifierOutcome: string | null
  consecutiveFails:  number
  pendingApprovals:  number
  stepCount:         number
  maxSteps:          number
  lastPlaybook:      string | null
  lastError:         string | null
}): string {
  return [
    `## Operasyon hedefi\n${obs.goalText}`,
    `## Son çalıştırma durumu\nstatus: ${obs.lastRunStatus ?? 'yok'}\nverifier_outcome: ${obs.lastVerifierOutcome ?? 'yok'}\nard arda başarısız: ${obs.consecutiveFails}`,
    `## Onay kuyruğu\nBekleyen onay sayısı: ${obs.pendingApprovals}`,
    `## İlerleme\n${obs.stepCount} / ${obs.maxSteps} adım kullanıldı`,
    obs.lastPlaybook ? `## Son playbook\n${obs.lastPlaybook}` : null,
    obs.lastError    ? `## Son hata (özet)\n${obs.lastError.slice(0, 300)}` : null,
  ].filter(Boolean).join('\n\n')
}
