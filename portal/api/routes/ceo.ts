import fs from 'node:fs/promises'
import path from 'node:path'
import { Router, type Request, type Response } from 'express'
import { getSupabaseAdmin } from '../lib/supabaseAdmin.js'
import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  Table,
  TableRow,
  TableCell,
  HeadingLevel,
  AlignmentType,
  BorderStyle,
  WidthType,
  ShadingType,
} from 'docx'

const router = Router()

type ReviewRow = {
  id: string
  job_id: string
  position: number
  question: string
  suggested_answer: string | null
  user_answer: string | null
  status: 'suggested' | 'edited' | 'approved'
  confidence: number | null
  updated_at: string
}

type JobRow = {
  id: string
  owner_user_id: string
  status: string
  mode: 'run' | 'bundle' | 'ceo' | 'ceo-iterate'
  domain_pack: string | null
  request_text: string | null
  answers_json: unknown | null
  selected_agents: string[] | null
  model: string | null
  web: boolean
  contrarian: boolean
  risk: 'R0' | 'R1' | 'R2' | 'R3'
  allow_high_risk: boolean
  result_json: unknown | null
}

type QuestionData = {
  runDir: string | null
  questions: string[]
  planText: string
}

type SavedAnswers = Record<string, string>

type ReviewSeed = Pick<
  ReviewRow,
  'position' | 'question' | 'suggested_answer' | 'user_answer' | 'status' | 'confidence'
>

function getBearerToken(req: Request) {
  const h = req.headers.authorization
  if (!h) return null
  const m = /^Bearer\s+(.+)$/.exec(h)
  return m?.[1] ?? null
}

async function getAuthedUser(req: Request) {
  const token = getBearerToken(req)
  if (!token) {
    throw new Error('Missing Authorization header')
  }
  const supabase = getSupabaseAdmin()
  const user = await supabase.auth.getUser(token)
  if (user.error || !user.data.user) {
    throw new Error('Invalid token')
  }
  return { supabase, user: user.data.user }
}

async function getOwnedJob(supabase: ReturnType<typeof getSupabaseAdmin>, ownerUserId: string, jobId: string) {
  const res = await supabase
    .from('run_requests')
    .select('id,owner_user_id,status,mode,domain_pack,request_text,answers_json,selected_agents,model,web,contrarian,risk,allow_high_risk,result_json')
    .eq('id', jobId)
    .eq('owner_user_id', ownerUserId)
    .maybeSingle()

  if (res.error) throw res.error
  if (!res.data) throw new Error('Job not found')
  return res.data as unknown as JobRow
}

function extractRunDir(resultJson: unknown) {
  if (!resultJson || typeof resultJson !== 'object') return null
  const imported = (resultJson as Record<string, unknown>).imported
  if (!imported || typeof imported !== 'object') return null
  const importedRunDirs = (imported as Record<string, unknown>).importedRunDirs
  if (!Array.isArray(importedRunDirs)) return null
  const first = importedRunDirs.find((x) => typeof x === 'string' && x.trim())
  return typeof first === 'string' ? first.trim() : null
}

function extractRunIdsFromResult(resultJson: unknown): string[] {
  if (!resultJson || typeof resultJson !== 'object') return []
  const r = resultJson as Record<string, unknown>
  const ids = new Set<string>()
  if (typeof r.run_id === 'string' && r.run_id.trim()) ids.add(r.run_id.trim())
  if (Array.isArray(r.playbook_run_ids)) {
    for (const x of r.playbook_run_ids) {
      if (typeof x === 'string' && x.trim()) ids.add(x.trim())
    }
  }
  return [...ids]
}

function parseClarifyingQuestions(value: unknown): string[] {
  if (!value) return []
  if (Array.isArray(value)) {
    return value
      .map((q) => (typeof q === 'string' ? q.trim() : ''))
      .filter(Boolean)
  }
  return []
}

function normalizeRequestKey(text: string | null) {
  return (text ?? '').toLowerCase().replace(/\s+/g, ' ').trim()
}

async function readQuestionsFromCeoPlans(
  supabase: ReturnType<typeof getSupabaseAdmin>,
  job: JobRow,
): Promise<{ questions: string[]; planText: string } | null> {
  if (!job.domain_pack) return null

  const res = await supabase
    .from('ceo_plans')
    .select('request_text,clarifying_questions,rationale,created_at')
    .eq('domain_pack', job.domain_pack)
    .order('created_at', { ascending: false })
    .limit(8)

  if (res.error) throw res.error
  const rows = res.data ?? []
  if (rows.length === 0) return null

  const jobKey = normalizeRequestKey(job.request_text)
  const row =
    rows.find((r) => {
      const planKey = normalizeRequestKey(typeof r.request_text === 'string' ? r.request_text : null)
      if (!jobKey || !planKey) return false
      return jobKey.includes(planKey) || planKey.includes(jobKey.slice(0, Math.min(80, jobKey.length)))
    }) ?? rows[0]

  const questions = parseClarifyingQuestions(row.clarifying_questions)
  if (questions.length === 0) return null

  const planText = typeof row.rationale === 'string' ? row.rationale : ''
  return { questions, planText }
}

async function readQuestionsFromRunsTable(
  supabase: ReturnType<typeof getSupabaseAdmin>,
  ownerUserId: string,
  runIds: string[],
): Promise<{ questions: string[]; planText: string } | null> {
  if (runIds.length === 0) return null

  const res = await supabase
    .from('runs')
    .select('output_text,external_id')
    .eq('owner_user_id', ownerUserId)
    .in('external_id', runIds)
    .order('created_at', { ascending: false })
    .limit(10)

  if (res.error) throw res.error

  for (const row of res.data ?? []) {
    const outputText = typeof row.output_text === 'string' ? row.output_text : ''
    const questions = parseQuestions(outputText)
    if (questions.length > 0) {
      return { questions, planText: extractPlanText(outputText) }
    }
  }
  return null
}

async function readQuestionsFromRunOutputs(
  supabase: ReturnType<typeof getSupabaseAdmin>,
  runIds: string[],
): Promise<string[]> {
  if (runIds.length === 0) return []

  const res = await supabase
    .from('run_outputs')
    .select('content_md,output_type')
    .in('run_id', runIds)
    .in('output_type', ['report', 'step', 'work'])
    .order('created_at', { ascending: false })
    .limit(20)

  if (res.error) throw res.error

  for (const row of res.data ?? []) {
    const md = typeof row.content_md === 'string' ? row.content_md : ''
    const questions = parseQuestions(md)
    if (questions.length > 0) return questions
  }
  return []
}

function parseQuestions(text: string) {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('- '))
    .map((line) => line.slice(2).trim())
    .filter(Boolean)
}

function extractPlanText(text: string) {
  const marker = '\nPlan: '
  const index = text.indexOf(marker)
  if (index === -1) return ''
  return text.slice(index + marker.length).trim()
}

function extractImportedCeoExternalId(runDir: string | null) {
  if (!runDir) return null
  const dirName = path.basename(runDir.trim())
  if (!dirName) return null
  return `ceo:${dirName}`
}

async function readQuestionsFromImportedRun(
  supabase: ReturnType<typeof getSupabaseAdmin>,
  ownerUserId: string,
  runDir: string | null,
) {
  const externalId = extractImportedCeoExternalId(runDir)
  if (!externalId) return null

  const res = await supabase
    .from('runs')
    .select('output_text')
    .eq('owner_user_id', ownerUserId)
    .eq('external_id', externalId)
    .order('created_at', { ascending: false })
    .limit(1)

  if (res.error) throw new Error(res.error.message)
  const outputText = typeof res.data?.[0]?.output_text === 'string' ? res.data[0].output_text : ''
  if (!outputText.trim()) return null

  return {
    questions: parseQuestions(outputText),
    planText: extractPlanText(outputText),
  }
}

function getErrorMessage(error: unknown, fallback: string) {
  if (error instanceof Error && error.message) return error.message
  if (error && typeof error === 'object' && 'message' in error && typeof error.message === 'string') {
    return error.message
  }
  return fallback
}

function isMissingReviewTableError(error: unknown) {
  return getErrorMessage(error, '').includes("public.ceo_question_reviews")
}

function readSavedAnswers(value: unknown): SavedAnswers {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return Object.entries(value).reduce<SavedAnswers>((acc, [key, raw]) => {
    if (typeof raw === 'string' && raw.trim()) {
      acc[key] = raw
    }
    return acc
  }, {})
}

function buildFallbackReviews(questions: string[], savedAnswers: SavedAnswers, existing: ReviewSeed[] = []) {
  return questions.map((question, index) => {
    const row = existing.find((item) => item.position === index + 1)
    const userAnswer = row?.user_answer ?? savedAnswers[question] ?? null
    return {
      position: index + 1,
      question,
      suggested_answer: row?.suggested_answer ?? null,
      user_answer: userAnswer,
      status: row?.status ?? (userAnswer ? 'edited' : 'suggested'),
      confidence: row?.confidence ?? null,
    }
  })
}

async function tryLoadReviews(
  supabase: ReturnType<typeof getSupabaseAdmin>,
  ownerUserId: string,
  jobId: string,
) {
  try {
    const reviews = await loadReviews(supabase, ownerUserId, jobId)
    return { reviews, tableAvailable: true }
  } catch (error) {
    if (isMissingReviewTableError(error)) {
      return { reviews: [] as ReviewRow[], tableAvailable: false }
    }
    throw error
  }
}

async function saveAnswersJson(
  supabase: ReturnType<typeof getSupabaseAdmin>,
  jobId: string,
  answers: SavedAnswers,
) {
  const updated = await supabase
    .from('run_requests')
    .update({ answers_json: answers })
    .eq('id', jobId)

  if (updated.error) throw updated.error
}

async function readQuestionsFromJob(
  supabase: ReturnType<typeof getSupabaseAdmin>,
  ownerUserId: string,
  job: JobRow,
): Promise<QuestionData> {
  const runDir = extractRunDir(job.result_json)
  const resultRunIds = extractRunIdsFromResult(job.result_json)

  if (job.mode === 'ceo' || job.mode === 'ceo-iterate') {
    const fromPlans = await readQuestionsFromCeoPlans(supabase, job)
    if (fromPlans && fromPlans.questions.length > 0) {
      return { runDir, questions: fromPlans.questions, planText: fromPlans.planText }
    }
    // CEO mode'da ceo_plans'ta soru yoksa boş dön — run output'u "soru" gibi gösterme.
    return { runDir, questions: [], planText: '' }
  }

  const fromRuns = await readQuestionsFromRunsTable(supabase, ownerUserId, resultRunIds)
  if (fromRuns && fromRuns.questions.length > 0) {
    return { runDir, questions: fromRuns.questions, planText: fromRuns.planText }
  }

  const fromOutputs = await readQuestionsFromRunOutputs(supabase, resultRunIds)
  if (fromOutputs.length > 0) {
    return { runDir, questions: fromOutputs, planText: '' }
  }

  if (runDir) {
    const qPath = path.join(runDir, 'questions.md')
    const planPath = path.join(runDir, 'plan.json')

    const questionsText = await fs.readFile(qPath, 'utf8').catch(() => '')
    const planText = await fs.readFile(planPath, 'utf8').catch(() => '')
    const questions = parseQuestions(questionsText)

    if (questions.length > 0) {
      return { runDir, questions, planText }
    }

    const imported = await readQuestionsFromImportedRun(supabase, ownerUserId, runDir)
    if (imported && imported.questions.length > 0) {
      return {
        runDir,
        questions: imported.questions,
        planText: imported.planText || planText,
      }
    }

    return { runDir, questions: [], planText }
  }

  return { runDir: null, questions: [], planText: '' }
}

async function loadReviews(supabase: ReturnType<typeof getSupabaseAdmin>, ownerUserId: string, jobId: string) {
  const res = await supabase
    .from('ceo_question_reviews')
    .select('id,job_id,position,question,suggested_answer,user_answer,status,confidence,updated_at')
    .eq('owner_user_id', ownerUserId)
    .eq('job_id', jobId)
    .order('position', { ascending: true })

  if (res.error) throw res.error
  return (res.data ?? []) as unknown as ReviewRow[]
}

async function generateSuggestedAnswers(job: JobRow, questions: string[], planText: string) {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) {
    throw new Error('Missing OPENAI_API_KEY')
  }

  const model = process.env.OPENAI_MODEL || job.model || 'gpt-4.1'

  // Her soru için position listesi; model bu listeyi birebir doldurmalı
  const questionLines = questions.map((q, i) => `${i + 1}. ${q}`).join('\n')

  const schemaExample = JSON.stringify({
    answers: questions.map((_, i) => ({
      position: i + 1,
      suggestedAnswer: '...',
      confidence: 0.85,
    })),
  }, null, 2)

  const prompt = [
    `Kullanıcının CEO sorularına taslak cevaplar üret. Toplam ${questions.length} soru var.`,
    `Her soru için kesinlikle bir cevap üretmelisin — answers dizisinde tam olarak ${questions.length} eleman olmalı.`,
    'Kısa, net, iş odaklı ve uygulanabilir cevaplar yaz. Sadece JSON döndür.',
    '',
    'Beklenen JSON formatı (her position için bir eleman):',
    schemaExample,
    '',
    'Kullanıcı isteği:',
    job.request_text ?? '',
    '',
    'Varsa mevcut cevap JSON:',
    job.answers_json ? JSON.stringify(job.answers_json) : '{}',
    '',
    planText ? `Plan/rationale:\n${planText}` : '',
    '',
    `Sorular (${questions.length} adet — hepsine cevap ver):`,
    questionLines,
  ].join('\n')

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content: 'You draft concise suggested answers for CEO clarifying questions. Return valid JSON only.',
        },
        {
          role: 'user',
          content: prompt,
        },
      ],
      temperature: 0.3,
    }),
  })

  const json = await res.json().catch(() => null)
  if (!res.ok) {
    throw new Error(`OpenAI request failed: ${JSON.stringify(json)}`)
  }

  const content = json?.choices?.[0]?.message?.content
  if (typeof content !== 'string' || !content.trim()) {
    throw new Error('OpenAI response missing content')
  }

  const parsed = JSON.parse(content) as {
    answers?: Array<{ position?: number; suggestedAnswer?: string; suggested_answer?: string; confidence?: number }>
  }

  return (parsed.answers ?? []).map((a, idx) => {
    // Model camelCase veya snake_case döndürebilir — ikisini de kabul et.
    const raw = a.suggestedAnswer ?? (a as Record<string, unknown>)['suggested_answer'] as string | undefined
    const text = typeof raw === 'string' && raw.trim() ? raw.trim() : null
    return {
      position: typeof a.position === 'number' ? a.position : idx + 1,
      suggested_answer: text,
      confidence: typeof a.confidence === 'number' ? a.confidence : null,
    }
  })
}

router.get('/jobs/:jobId/review', async (req: Request, res: Response) => {
  try {
    const { supabase, user } = await getAuthedUser(req)
    const job = await getOwnedJob(supabase, user.id, req.params.jobId)
    const questionData = await readQuestionsFromJob(supabase, user.id, job)
    const savedAnswers = readSavedAnswers(job.answers_json)
    const { reviews } = await tryLoadReviews(supabase, user.id, job.id)
    const merged = buildFallbackReviews(questionData.questions, savedAnswers, reviews)

    res.status(200).json({
      success: true,
      job: {
        id: job.id,
        mode: job.mode,
        status: job.status,
        request_text: job.request_text,
        domain_pack: job.domain_pack,
      },
      runDir: questionData.runDir,
      reviews: merged,
    })
  } catch (e: unknown) {
    const message = getErrorMessage(e, 'Review fetch failed')
    res.status(500).json({ success: false, error: message })
  }
})

router.post('/jobs/:jobId/review/generate', async (req: Request, res: Response) => {
  try {
    const { supabase, user } = await getAuthedUser(req)
    const job = await getOwnedJob(supabase, user.id, req.params.jobId)
    const { questions, planText } = await readQuestionsFromJob(supabase, user.id, job)
    if (questions.length === 0) {
      res.status(200).json({ success: true, reviews: [] })
      return
    }

    const suggested = await generateSuggestedAnswers(job, questions, planText)
    const savedAnswers = readSavedAnswers(job.answers_json)
    const { reviews: existing, tableAvailable } = await tryLoadReviews(supabase, user.id, job.id)
    const payload = questions.map((question, index) => {
      const match = suggested.find((x) => x.position === index + 1)
      const current = existing.find((x) => x.position === index + 1)
      return {
        owner_user_id: user.id,
        job_id: job.id,
        position: index + 1,
        question,
        suggested_answer: match?.suggested_answer ?? null,
        user_answer: current?.user_answer ?? savedAnswers[question] ?? null,
        status: current?.status ?? 'suggested',
        confidence: match?.confidence ?? null,
      }
    })

    if (!tableAvailable) {
      res.status(200).json({
        success: true,
        reviews: buildFallbackReviews(questions, savedAnswers, payload),
      })
      return
    }

    const upserted = await supabase
      .from('ceo_question_reviews')
      .upsert(payload, { onConflict: 'job_id,position' })
      .select('id,job_id,position,question,suggested_answer,user_answer,status,confidence,updated_at')
      .order('position', { ascending: true })

    if (upserted.error) throw upserted.error
    res.status(200).json({ success: true, reviews: upserted.data ?? [] })
  } catch (e: unknown) {
    const message = getErrorMessage(e, 'Suggestion generation failed')
    res.status(500).json({ success: false, error: message })
  }
})

router.post('/jobs/:jobId/review', async (req: Request, res: Response) => {
  try {
    const { supabase, user } = await getAuthedUser(req)
    const job = await getOwnedJob(supabase, user.id, req.params.jobId)
    const items = Array.isArray(req.body?.items) ? req.body.items : []
    const { questions } = await readQuestionsFromJob(supabase, user.id, job)
    const savedAnswers = readSavedAnswers(job.answers_json)
    const { reviews: existing, tableAvailable } = await tryLoadReviews(supabase, user.id, job.id)

    const payload = questions.map((question, index) => {
      const position = index + 1
      const incoming = items.find((item) => item && typeof item === 'object' && item.position === position) as
        | { user_answer?: string; status?: string }
        | undefined
      const current = existing.find((row) => row.position === position)
      const userAnswer = typeof incoming?.user_answer === 'string'
        ? incoming.user_answer
        : (current?.user_answer ?? savedAnswers[question] ?? null)
      const status: ReviewRow['status'] = incoming?.status === 'approved' || incoming?.status === 'edited' || incoming?.status === 'suggested'
        ? incoming.status
        : (current?.status ?? 'suggested')

      return {
        owner_user_id: user.id,
        job_id: job.id,
        position,
        question,
        suggested_answer: current?.suggested_answer ?? null,
        user_answer: userAnswer,
        status,
        confidence: current?.confidence ?? null,
      }
    })

    const answers = payload.reduce<SavedAnswers>((acc, row) => {
      if (typeof row.user_answer === 'string' && row.user_answer.trim()) {
        acc[row.question] = row.user_answer
      }
      return acc
    }, {})

    await saveAnswersJson(supabase, job.id, answers)

    if (tableAvailable && payload.length > 0) {
      const upserted = await supabase
        .from('ceo_question_reviews')
        .upsert(payload, { onConflict: 'job_id,position' })

      if (upserted.error) throw upserted.error
    }

    if (!tableAvailable) {
      res.status(200).json({ success: true, reviews: buildFallbackReviews(questions, answers, payload) })
      return
    }

    const reviews = await loadReviews(supabase, user.id, job.id)
    res.status(200).json({ success: true, reviews })
  } catch (e: unknown) {
    const message = getErrorMessage(e, 'Review save failed')
    res.status(500).json({ success: false, error: message })
  }
})

router.post('/jobs/:jobId/review/iterate', async (req: Request, res: Response) => {
  try {
    const { supabase, user } = await getAuthedUser(req)
    const job = await getOwnedJob(supabase, user.id, req.params.jobId)
    const savedAnswers = readSavedAnswers(job.answers_json)
    const { reviews, tableAvailable } = await tryLoadReviews(supabase, user.id, job.id)

    const answers = tableAvailable && reviews.length > 0
      ? reviews.reduce<Record<string, string>>((acc, row) => {
          const finalAnswer = (row.user_answer && row.user_answer.trim()) || (row.suggested_answer && row.suggested_answer.trim()) || ''
          if (finalAnswer) {
            acc[row.question] = finalAnswer
          }
          return acc
        }, {})
      : savedAnswers

    const inserted = await supabase
      .from('run_requests')
      .insert({
        owner_user_id: user.id,
        mode: 'ceo-iterate',
        domain_pack: job.domain_pack,
        request_text: job.request_text,
        answers_json: answers,
        selected_agents: job.selected_agents,
        model: job.model,
        web: job.web,
        contrarian: job.contrarian,
        risk: job.risk,
        allow_high_risk: job.allow_high_risk,
      })
      .select('id')
      .single()

    if (inserted.error) throw inserted.error
    res.status(200).json({ success: true, jobId: inserted.data.id })
  } catch (e: unknown) {
    const message = getErrorMessage(e, 'Iterate job creation failed')
    res.status(500).json({ success: false, error: message })
  }
})

// ── Visual generation helpers ────────────────────────────────────────────────

type WikiImage = { url: string; title: string; description: string }

async function searchWikimediaImages(query: string, limit = 4): Promise<WikiImage[]> {
  try {
    const params = new URLSearchParams({
      action: 'query', generator: 'search',
      gsrsearch: `${query} archaeological site photo`,
      gsrnamespace: '6', prop: 'imageinfo',
      iiprop: 'url|thumburl|extmetadata', iiurlwidth: '900',
      format: 'json', gsrlimit: String(limit + 4), // fetch extra, filter below
    })
    const res = await fetch(`https://commons.wikimedia.org/w/api.php?${params}`, {
      headers: { 'User-Agent': 'AgentArmy/1.0 research-tool' },
    })
    if (!res.ok) return []
    const data = await res.json() as {
      query?: { pages?: Record<string, {
        title?: string
        imageinfo?: Array<{ thumburl?: string; url?: string; extmetadata?: { ImageDescription?: { value?: string } } }>
      }> }
    }
    const pages = Object.values(data.query?.pages ?? {})
    const results: WikiImage[] = []
    for (const page of pages) {
      const info = page.imageinfo?.[0]
      if (!info?.thumburl) continue
      // Skip SVGs and small icons
      const url = info.url ?? ''
      if (url.endsWith('.svg') || url.endsWith('.pdf')) continue
      const rawDesc = info.extmetadata?.ImageDescription?.value ?? ''
      const description = rawDesc.replace(/<[^>]+>/g, '').trim().slice(0, 300)
      results.push({ url: info.thumburl, title: (page.title ?? '').replace('File:', ''), description })
      if (results.length >= limit) break
    }
    return results
  } catch { return [] }
}

async function generateDalleImage(prompt: string, apiKey: string): Promise<string | null> {
  try {
    const res = await fetch('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'dall-e-3', prompt, n: 1, size: '1792x1024', quality: 'standard' }),
    })
    if (!res.ok) return null
    const data = await res.json() as { data?: Array<{ url?: string }> }
    return data.data?.[0]?.url ?? null
  } catch { return null }
}

async function extractLocations(text: string, apiKey: string, model: string) {
  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: `Bu araştırma metnindeki coğrafi konumları çıkar, koordinatlarını ver. JSON: {"locations":[{"name":"Boğazköy-Hattuşa","lat":40.0194,"lon":34.6156}]}\n\nMetin:\n${text.slice(0, 600)}` }],
        response_format: { type: 'json_object' }, max_tokens: 400, temperature: 0,
      }),
    })
    if (!res.ok) return []
    const data = await res.json() as { choices?: Array<{ message?: { content?: string } }> }
    const content = data.choices?.[0]?.message?.content
    if (!content) return []
    const parsed = JSON.parse(content) as { locations?: Array<{ name: string; lat: number; lon: number }> }
    return (parsed.locations ?? []).filter((l) => l.lat && l.lon).slice(0, 6)
  } catch { return [] }
}

function buildMapUrl(locations: Array<{ name: string; lat: number; lon: number }>): string {
  const base = 'https://staticmap.openstreetmap.de/staticmap.php'
  if (locations.length === 0) return `${base}?center=39.5,35&zoom=6&size=800x400&maptype=mapnik`
  const avgLat = locations.reduce((s, l) => s + l.lat, 0) / locations.length
  const avgLon = locations.reduce((s, l) => s + l.lon, 0) / locations.length
  const zoom = locations.length <= 2 ? 8 : 7
  const markers = locations.map((l) => `${l.lat},${l.lon},red-pushpin`).join('|')
  return `${base}?center=${avgLat.toFixed(4)},${avgLon.toFixed(4)}&zoom=${zoom}&size=800x400&maptype=mapnik&markers=${markers}`
}

// ── POST /api/ceo/jobs/:jobId/generate-visuals ───────────────────────────────

router.post('/jobs/:jobId/generate-visuals', async (req: Request, res: Response) => {
  try {
    const { supabase, user } = await getAuthedUser(req)
    const job = await getOwnedJob(supabase, user.id, req.params.jobId)

    const apiKey = process.env.OPENAI_API_KEY
    if (!apiKey) throw new Error('Missing OPENAI_API_KEY')
    const model = process.env.OPENAI_MODEL || job.model || 'gpt-4.1-mini'

    const runIds = extractRunIdsFromResult(job.result_json)
    const primaryRunId = runIds[0]
    if (!primaryRunId) throw new Error('Job henüz run_id üretmemiş — job tamamlandıktan sonra tekrar deneyin')

    const topic = job.request_text ?? job.domain_pack ?? 'archaeological research'
    const searchQuery = (job.domain_pack ?? topic).replace(/-/g, ' ').slice(0, 80)

    const inserts: Array<Record<string, unknown>> = []

    // 1. DALL-E illustrative image
    const dallePrompt = `Archaeological research visualization: ${topic.slice(0, 200)}. Detailed, photorealistic, museum-quality historical illustration, professional lighting, no text overlays, cinematic perspective.`
    const dalleUrl = await generateDalleImage(dallePrompt, apiKey)
    if (dalleUrl) {
      inserts.push({
        run_id: primaryRunId, step_id: 'visual-dalle', agent_id: 'VisualAgent',
        artifact_name: 'AI İllüstrasyon',
        output_type: 'image',
        content_json: { url: dalleUrl, type: 'dalle', source: 'DALL-E 3', alt: topic.slice(0, 150), expiring: true },
      })
    }

    // 2. Wikimedia real photos
    const wikiImages = await searchWikimediaImages(searchQuery, 4)
    for (const img of wikiImages) {
      inserts.push({
        run_id: primaryRunId, step_id: 'visual-wikimedia', agent_id: 'VisualAgent',
        artifact_name: img.title.slice(0, 100),
        output_type: 'image',
        content_json: { url: img.url, type: 'wikimedia', source: 'Wikimedia Commons', alt: img.description || img.title, title: img.title },
      })
    }

    // 3. Geographic map
    const locations = await extractLocations(topic, apiKey, model)
    const mapUrl = buildMapUrl(locations)
    inserts.push({
      run_id: primaryRunId, step_id: 'visual-map', agent_id: 'VisualAgent',
      artifact_name: 'Coğrafi Harita',
      output_type: 'image',
      content_json: { url: mapUrl, type: 'map', source: 'OpenStreetMap', alt: 'Araştırma bölgesi haritası', locations },
    })

    const { error } = await supabase.from('run_outputs').insert(inserts)
    if (error) throw error

    res.status(200).json({ success: true, count: inserts.length, dalle: !!dalleUrl, wikimedia: wikiImages.length, map: true })
  } catch (e: unknown) {
    const message = getErrorMessage(e, 'Visual generation failed')
    res.status(500).json({ success: false, error: message })
  }
})

// ── Markdown → docx elements (paragraphs + tables) ──────────────────────────

type DocxChild = Paragraph | Table

function inlineRuns(text: string, baseSize = 22): TextRun[] {
  const runs: TextRun[] = []
  const re = /\*\*(.+?)\*\*|__(.+?)__|`([^`]+)`|\*([^*]+)\*|_([^_]+)_/g
  let last = 0, m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) runs.push(new TextRun({ text: text.slice(last, m.index), size: baseSize }))
    if      (m[1] != null) runs.push(new TextRun({ text: m[1], bold: true, size: baseSize }))
    else if (m[2] != null) runs.push(new TextRun({ text: m[2], bold: true, size: baseSize }))
    else if (m[3] != null) runs.push(new TextRun({ text: m[3], size: baseSize, font: 'Consolas' }))
    else if (m[4] != null) runs.push(new TextRun({ text: m[4], italics: true, size: baseSize }))
    else if (m[5] != null) runs.push(new TextRun({ text: m[5], italics: true, size: baseSize }))
    last = m.index + m[0].length
  }
  if (last < text.length) runs.push(new TextRun({ text: text.slice(last), size: baseSize }))
  return runs.length > 0 ? runs : [new TextRun({ text, size: baseSize })]
}

function isTableLineMd(s: string) { return s.trim().startsWith('|') && s.trim().includes('|', 1) }
function isSepLineMd(s: string)   { return /^\|[\s\-:|]+\|$/.test(s.trim()) }
function parseRowMd(s: string)    { return s.split('|').slice(1, -1).map((c) => c.trim()) }

function makeDocxTable(headers: string[], rows: string[][]): Table {
  const colCount = Math.max(headers.length, ...rows.map((r) => r.length), 1)
  const tableWidth = 9000
  const colWidth = Math.floor(tableWidth / colCount)
  const border = { style: BorderStyle.SINGLE, size: 1, color: 'CCCCCC' }
  const borders = { top: border, bottom: border, left: border, right: border, insideH: border, insideV: border }
  return new Table({
    width: { size: tableWidth, type: WidthType.DXA },
    columnWidths: Array<number>(colCount).fill(colWidth),
    rows: [
      new TableRow({
        tableHeader: true,
        children: headers.map((h) => new TableCell({
          borders, width: { size: colWidth, type: WidthType.DXA },
          shading: { fill: '1A1A2E', type: ShadingType.CLEAR },
          margins: { top: 80, bottom: 80, left: 160, right: 160 },
          children: [new Paragraph({ children: [new TextRun({ text: h, bold: true, size: 20, color: 'FFFFFF', font: 'Arial' })] })],
        })),
      }),
      ...rows.map((row, ri) => new TableRow({
        children: Array.from({ length: colCount }, (_, ci) => new TableCell({
          borders, width: { size: colWidth, type: WidthType.DXA },
          shading: { fill: ri % 2 === 0 ? 'FFFFFF' : 'F7F5F2', type: ShadingType.CLEAR },
          margins: { top: 80, bottom: 80, left: 160, right: 160 },
          children: [new Paragraph({ children: inlineRuns(row[ci] ?? '', 20) })],
        })),
      })),
    ],
  })
}

function mdToDocx(md: string): DocxChild[] {
  const result: DocxChild[] = []
  const lines = md.split('\n')
  let i = 0
  while (i < lines.length) {
    const line = lines[i].trimEnd()
    if (/^### /.test(line)) {
      result.push(new Paragraph({ text: line.slice(4), heading: HeadingLevel.HEADING_3, spacing: { before: 180, after: 80 } }))
    } else if (/^## /.test(line)) {
      result.push(new Paragraph({ text: line.slice(3), heading: HeadingLevel.HEADING_2, spacing: { before: 260, after: 120 } }))
    } else if (/^# /.test(line)) {
      result.push(new Paragraph({ text: line.slice(2), heading: HeadingLevel.HEADING_1, spacing: { before: 340, after: 160 } }))
    } else if (/^(-{3,}|\*{3,})$/.test(line.trim())) {
      result.push(new Paragraph({ border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: 'CCCCCC', space: 4 } }, spacing: { before: 200, after: 200 }, text: '' }))
    } else if (/^> /.test(line)) {
      const bqLines: string[] = []
      while (i < lines.length && /^> ?/.test(lines[i])) { bqLines.push(lines[i].replace(/^> ?/, '')); i++ }
      for (const b of bqLines) {
        result.push(new Paragraph({
          children: inlineRuns(b, 22),
          indent: { left: 360 },
          border: { left: { style: BorderStyle.SINGLE, size: 16, color: '0F3460', space: 12 } },
          spacing: { after: 60 },
        }))
      }
      continue
    } else if (isTableLineMd(line)) {
      const tableLines: string[] = []
      while (i < lines.length && isTableLineMd(lines[i])) { tableLines.push(lines[i]); i++ }
      const allRows = tableLines.filter((l) => !isSepLineMd(l))
      const [headerLine, ...dataLines] = allRows
      if (headerLine) {
        result.push(new Paragraph({ text: '', spacing: { before: 120, after: 0 } }))
        result.push(makeDocxTable(parseRowMd(headerLine), dataLines.map(parseRowMd)))
        result.push(new Paragraph({ text: '', spacing: { before: 0, after: 120 } }))
      }
      continue
    } else if (/^[-*] /.test(line)) {
      const items: string[] = []
      while (i < lines.length && /^[-*] /.test(lines[i].trimEnd())) { items.push(lines[i].trimEnd().slice(2)); i++ }
      for (const b of items) result.push(new Paragraph({ children: inlineRuns(b, 22), bullet: { level: 0 }, spacing: { after: 40 } }))
      continue
    } else if (/^\d+\. /.test(line)) {
      const items: string[] = []
      while (i < lines.length && /^\d+\. /.test(lines[i].trimEnd())) { items.push(lines[i].trimEnd().replace(/^\d+\.\s*/, '')); i++ }
      for (const b of items) result.push(new Paragraph({ children: inlineRuns(b, 22), bullet: { level: 0 }, spacing: { after: 40 } }))
      continue
    } else if (/^```/.test(line)) {
      const codeLines: string[] = []; i++
      while (i < lines.length && !/^```/.test(lines[i])) { codeLines.push(lines[i]); i++ }
      result.push(new Paragraph({
        children: codeLines.flatMap((cl, ci) => [
          ...(ci > 0 ? [new TextRun({ text: '', break: 1 })] : []),
          new TextRun({ text: cl, font: 'Consolas', size: 18, color: '333333' }),
        ]),
        shading: { fill: 'F5F5F5', type: ShadingType.CLEAR },
        border: { left: { style: BorderStyle.SINGLE, size: 16, color: '0F3460', space: 10 } },
        indent: { left: 180 },
        spacing: { before: 80, after: 80 },
      }))
    } else if (!line.trim()) {
      result.push(new Paragraph({ text: '', spacing: { after: 80 } }))
    } else {
      result.push(new Paragraph({ children: inlineRuns(line, 22), spacing: { after: 80 } }))
    }
    i++
  }
  return result
}

// ── GET /api/ceo/jobs/:jobId/report.docx ────────────────────────────────────

router.get('/jobs/:jobId/report.docx', async (req: Request, res: Response) => {
  try {
    const { supabase, user } = await getAuthedUser(req)
    const job = await getOwnedJob(supabase, user.id, req.params.jobId)

    const runIds = extractRunIdsFromResult(job.result_json)

    const outRes = await supabase
      .from('run_outputs')
      .select('id,run_id,step_id,agent_id,artifact_name,output_type,content_md,content_json,created_at')
      .in('run_id', runIds.length > 0 ? runIds : ['__none__'])
      .order('created_at', { ascending: true })

    if (outRes.error) throw outRes.error
    const outputs = outRes.data ?? []

    const domainLabel = (job.domain_pack ?? 'AgentArmy')
      .replace(/-/g, ' ')
      .replace(/\b\w/g, (c: string) => c.toUpperCase())

    const createdDate = new Date(
      (job as unknown as Record<string, unknown>).created_at as string ?? Date.now()
    ).toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' })

    // ── Helper ──────────────────────────────────────────────────────────────
    function divider(): Paragraph {
      return new Paragraph({
        border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: 'DDDDDD', space: 6 } },
        spacing: { before: 280, after: 280 },
        text: '',
      })
    }

    // ── Cover page ──────────────────────────────────────────────────────────
    const coverChildren: DocxChild[] = [
      // Big blank for vertical centering
      new Paragraph({ text: '', spacing: { before: 2400, after: 0 } }),

      // Label
      new Paragraph({
        children: [new TextRun({ text: 'AGENTARMY · ARAŞTIRMA RAPORU', size: 18, color: '8899AA', font: 'Arial', allCaps: true })],
        alignment: AlignmentType.CENTER,
        spacing: { before: 0, after: 240 },
      }),

      // Title
      new Paragraph({
        children: [new TextRun({
          text: job.request_text
            ? job.request_text.slice(0, 140) + (job.request_text.length > 140 ? '…' : '')
            : domainLabel,
          size: 44, bold: true, font: 'Arial', color: '1A1A2E',
        })],
        alignment: AlignmentType.CENTER,
        spacing: { before: 0, after: 600 },
      }),

      // Separator line
      new Paragraph({
        border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: '0F3460', space: 1 } },
        spacing: { before: 0, after: 240 },
        text: '',
      }),

      // Meta row
      new Paragraph({
        children: [
          new TextRun({ text: 'Domain Pack   ', size: 18, color: '888888', font: 'Arial' }),
          new TextRun({ text: domainLabel, size: 18, font: 'Arial', bold: true, color: '1A1A2E' }),
          new TextRun({ text: '     |     Mod   ', size: 18, color: '888888', font: 'Arial' }),
          new TextRun({ text: job.mode, size: 18, font: 'Arial', bold: true, color: '1A1A2E' }),
          new TextRun({ text: '     |     Tarih   ', size: 18, color: '888888', font: 'Arial' }),
          new TextRun({ text: createdDate, size: 18, font: 'Arial', bold: true, color: '1A1A2E' }),
        ],
        alignment: AlignmentType.CENTER,
        spacing: { before: 0, after: 2880 },
      }),
    ]

    // ── Sections: request + outputs ─────────────────────────────────────────
    const bodyChildren: DocxChild[] = []

    // Request box
    if (job.request_text) {
      bodyChildren.push(
        new Paragraph({
          children: [new TextRun({ text: 'ARAŞTIRMA İSTEĞİ', size: 16, bold: true, font: 'Arial', color: '0F3460', allCaps: true })],
          spacing: { before: 360, after: 80 },
          border: { left: { style: BorderStyle.SINGLE, size: 18, color: '0F3460', space: 12 } },
          indent: { left: 220 },
        }),
        ...job.request_text.split('\n').map((line) =>
          new Paragraph({
            children: [new TextRun({ text: line, size: 22, font: 'Georgia', color: '2D2D2D' })],
            spacing: { before: 0, after: 60 },
            indent: { left: 220 },
            border: { left: { style: BorderStyle.SINGLE, size: 18, color: '0F3460', space: 12 } },
          })
        ),
        new Paragraph({ text: '', spacing: { before: 160, after: 0 } }),
      )
    }

    bodyChildren.push(divider())

    if (outputs.length === 0) {
      bodyChildren.push(new Paragraph({
        children: [new TextRun({ text: 'Bu job için henüz çıktı kaydedilmemiş.', size: 22, color: '999999', italics: true })],
        spacing: { before: 240 },
      }))
    }

    for (let i = 0; i < outputs.length; i++) {
      const o = outputs[i]
      const title = o.artifact_name ?? o.step_id ?? o.output_type
      const agentLabel = o.agent_id ? ` — ${o.agent_id}` : ''

      // Section number + title
      bodyChildren.push(
        new Paragraph({
          children: [
            new TextRun({ text: `${i + 1}.  `, size: 28, bold: true, font: 'Arial', color: '0F3460' }),
            new TextRun({ text: title + agentLabel, size: 28, bold: true, font: 'Arial', color: '1A1A2E' }),
          ],
          heading: HeadingLevel.HEADING_2,
          spacing: { before: 400, after: 120 },
        }),
        new Paragraph({
          children: [new TextRun({ text: o.run_id, size: 16, color: 'BBBBBB', font: 'Consolas' })],
          spacing: { before: 0, after: 120 },
        }),
      )

      // Content
      let bodyMd = ''
      if (o.content_md?.trim()) {
        bodyMd = o.content_md
      } else if (o.content_json != null) {
        try { bodyMd = JSON.stringify(o.content_json, null, 2) }
        catch { bodyMd = String(o.content_json) }
      }

      if (bodyMd) bodyChildren.push(...mdToDocx(bodyMd))
      bodyChildren.push(divider())
    }

    // Footer
    bodyChildren.push(
      new Paragraph({
        children: [new TextRun({ text: `AgentArmy · ${domainLabel} · ${createdDate}`, size: 18, color: 'AAAAAA', font: 'Arial' })],
        alignment: AlignmentType.CENTER,
        spacing: { before: 480, after: 0 },
      }),
    )

    // ── Document ─────────────────────────────────────────────────────────────
    const doc = new Document({
      styles: {
        default: {
          document: { run: { font: 'Georgia', size: 22, color: '2D2D2D' } },
        },
        paragraphStyles: [
          {
            id: 'Heading1', name: 'Heading 1', basedOn: 'Normal', next: 'Normal', quickFormat: true,
            run: { size: 36, bold: true, font: 'Arial', color: '1A1A2E' },
            paragraph: { spacing: { before: 360, after: 160 }, outlineLevel: 0 },
          },
          {
            id: 'Heading2', name: 'Heading 2', basedOn: 'Normal', next: 'Normal', quickFormat: true,
            run: { size: 28, bold: true, font: 'Arial', color: '16213E' },
            paragraph: { spacing: { before: 320, after: 120 }, outlineLevel: 1 },
          },
          {
            id: 'Heading3', name: 'Heading 3', basedOn: 'Normal', next: 'Normal', quickFormat: true,
            run: { size: 24, bold: true, font: 'Arial', color: '0F3460' },
            paragraph: { spacing: { before: 200, after: 80 }, outlineLevel: 2 },
          },
        ],
      },
      sections: [
        // Cover page
        {
          properties: {
            page: {
              size: { width: 11906, height: 16838 },
              margin: { top: 1440, right: 1800, bottom: 1440, left: 1800 },
            },
          },
          children: coverChildren,
        },
        // Body pages
        {
          properties: {
            page: {
              size: { width: 11906, height: 16838 },
              margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 },
            },
          },
          children: bodyChildren,
        },
      ],
    })

    const buffer = await Packer.toBuffer(doc)
    const filename = `agentarmy-raporu-${job.id.slice(0, 8)}.docx`

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`)
    res.send(buffer)
  } catch (e: unknown) {
    const message = getErrorMessage(e, 'Report generation failed')
    res.status(500).json({ success: false, error: message })
  }
})

export default router
