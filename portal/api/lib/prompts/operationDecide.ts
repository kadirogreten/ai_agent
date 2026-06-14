/**
 * Operasyon döngüsü — DECIDE fazı prompt'u.
 * LLM'e gönderilecek system prompt ve JSON sözleşmesini tanımlar.
 * operationLoopTick.ts bu modülü import eder; prompt gömülü değildir.
 *
 * PR6: Tedarik fazı örnekleri eklendi; lastResultSummary + availablePlaybooks parametresi.
 * PR14: buildDecideSystemPrompt(supabase, kind) — decide_prompts tablosundan 5dk cache ile okur.
 *       DB'den okuma başarısız olursa DECIDE_SYSTEM_PROMPT sabit string'e düşer (fallback).
 */

import type { SupabaseClient } from '@supabase/supabase-js'

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

// ── DB-first prompt cache ──────────────────────────────────────────────────────

type CacheEntry = { content: string; expiresAt: number }
const PROMPT_CACHE = new Map<string, CacheEntry>()
const CACHE_TTL_MS = 5 * 60 * 1000 // 5 dakika

/**
 * decide_prompts tablosundan base + kind-specific parçaları birleştirir.
 * 5dk in-memory cache; DB'de kayıt yoksa veya hata varsa DECIDE_SYSTEM_PROMPT'a düşer.
 */
export async function buildDecideSystemPrompt(
  supabase: SupabaseClient,
  kind: string,
): Promise<string> {
  const cacheKey = `decide:${kind}`
  const now = Date.now()
  const cached = PROMPT_CACHE.get(cacheKey)
  if (cached && cached.expiresAt > now) return cached.content

  try {
    const scopes = kind === 'base' ? ['base'] : ['base', kind]
    const { data, error } = await supabase
      .from('decide_prompts')
      .select('scope, content')
      .in('scope', scopes)

    if (error || !data || data.length === 0) {
      return DECIDE_SYSTEM_PROMPT
    }

    const rows = data as { scope: string; content: string }[]
    const base    = rows.find((r) => r.scope === 'base')?.content ?? DECIDE_SYSTEM_PROMPT
    const specific = kind !== 'base' ? rows.find((r) => r.scope === kind)?.content : null
    const combined = specific ? `${base}\n\n${specific}` : base

    PROMPT_CACHE.set(cacheKey, { content: combined, expiresAt: now + CACHE_TTL_MS })
    return combined
  } catch {
    return DECIDE_SYSTEM_PROMPT
  }
}

export interface IntentJson {
  beneficiary:      string
  success_criteria: string
  forbidden_tools?: string[]
  forbidden_topics?: string[]
  max_total_spend?: number
  expires_at?:      string
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
  intent?:             IntentJson | null
}): string {
  return [
    `## Operasyon hedefi\n${obs.goalText}`,

    obs.intent ? [
      `## Intent sözleşmesi`,
      `Yararlanıcı: ${obs.intent.beneficiary}`,
      `Başarı kriteri: ${obs.intent.success_criteria}`,
      obs.intent.forbidden_tools?.length
        ? `Yasak araçlar: ${obs.intent.forbidden_tools.join(', ')}`
        : null,
      obs.intent.forbidden_topics?.length
        ? `Yasak konular: ${obs.intent.forbidden_topics.join(', ')}`
        : null,
      obs.intent.expires_at
        ? `Vade: ${obs.intent.expires_at}`
        : null,
    ].filter(Boolean).join('\n') : null,

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
