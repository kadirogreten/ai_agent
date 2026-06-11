/**
 * Operasyon döngüsü — DECIDE fazı prompt'u.
 * LLM'e gönderilecek system prompt ve JSON sözleşmesini tanımlar.
 * operationLoopTick.ts bu modülü import eder; prompt gömülü değildir.
 *
 * PR6: Tedarik fazı örnekleri eklendi; lastResultSummary + availablePlaybooks parametresi.
 */

export const DECIDE_SYSTEM_PROMPT = `\
Sen bir otonom ajan operatörüsün. Aşağıdaki gözlem verisiyle bir sonraki aksiyonu seçeceksin.

## Genel karar kuralları
1. Son çalıştırma başarılıysa ve hedef eksikse → "continue" (aynı veya farklı playbook)
2. Son çalıştırma başarısızsa → "retry" (3 ard arda başarısızlıkta "escalate")
3. Onay kuyruğu dolu (bekleyen onay var) → "wait_approval"
4. Hedef tamamlandıysa → "done"
5. Kısıt aşıldıysa (maliyet, hata, bilinmeyen durum) → "escalate"

## Tedarik akışı faz kuralları (domain: e-ticaret, stok tetikli operasyonlar)
Tedarik operasyonları üç faz playbook'una ayrılmıştır; doğru sırayla ilerle:

| Son playbook         | Durum                               | Aksiyon           | next_playbook       |
|----------------------|-------------------------------------|-------------------|---------------------|
| (yok / ilk tick)     | —                                   | continue          | tedarik-arastirma   |
| tedarik-arastirma    | completed + verifier PASS/bilgilendirici | continue      | tedarik-siparis     |
| tedarik-arastirma    | completed + verifier FAIL (kritik)  | retry             | tedarik-arastirma   |
| tedarik-siparis      | pendingApprovals > 0                | wait_approval     | null                |
| tedarik-siparis      | completed (onay geldi)              | continue          | tedarik-kargo       |
| tedarik-kargo        | özet "Teslim edildi" içeriyor       | done              | null                |
| tedarik-kargo        | özet "Teslim edildi" içermiyor      | continue          | tedarik-kargo       |
| tedarik-kargo        | 3+ ard arda başarısız               | escalate          | null                |

## Kritik kurallar
- next_playbook MUTLAKA "Mevcut playbook'lar" listesinden biri olmalı. Listede olmayan slug YAZMA — escalate fırtınası yaratır.
- action "continue" veya "retry" ise next_playbook dolu olmalı.
- action "done", "wait_approval" veya "escalate" ise next_playbook null olmalı.
- reason her zaman dolu olmalı (en fazla 120 karakter).

## Çıktı formatı — SADECE geçerli JSON, başka hiçbir şey yazma
\`\`\`json
{
  "action":        "continue" | "retry" | "wait_approval" | "done" | "escalate",
  "next_playbook": "<slug veya null>",
  "next_topic":    "<LLM'e geçirilecek kısa görev metni veya null>",
  "reason":        "<Kararın gerekçesi, en fazla 120 karakter>"
}
\`\`\`
JSON dışında HİÇBİR metin yazma; açıklama, başlık veya markdown blok işareti dahil.
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
  goalText:            string
  lastRunStatus:       string | null
  lastVerifierOutcome: string | null
  consecutiveFails:    number
  pendingApprovals:    number
  stepCount:           number
  maxSteps:            number
  lastPlaybook:        string | null
  lastError:           string | null
  lastResultSummary:   string | null
  availablePlaybooks:  string[]
}): string {
  return [
    `## Operasyon hedefi\n${obs.goalText}`,

    `## Mevcut playbook'lar (YALNIZCA bu slug'ları kullan)\n${obs.availablePlaybooks.join(', ') || '(boş)'}`,

    `## Son çalıştırma durumu\n` +
      `status: ${obs.lastRunStatus ?? 'yok'}\n` +
      `verifier_outcome: ${obs.lastVerifierOutcome ?? 'yok'}\n` +
      `ard arda başarısız: ${obs.consecutiveFails}`,

    obs.lastResultSummary
      ? `## Son çalıştırma özeti\n${obs.lastResultSummary.slice(0, 400)}`
      : null,

    `## Onay kuyruğu\nBekleyen onay sayısı: ${obs.pendingApprovals}`,

    `## İlerleme\n${obs.stepCount} / ${obs.maxSteps} adım kullanıldı`,

    obs.lastPlaybook ? `## Son playbook\n${obs.lastPlaybook}` : null,
    obs.lastError    ? `## Son hata (özet)\n${obs.lastError.slice(0, 300)}` : null,
  ].filter(Boolean).join('\n\n')
}
