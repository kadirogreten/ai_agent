import fs from 'node:fs/promises'
import path from 'node:path'
import { Router, type Request, type Response } from 'express'
import { getSupabaseAdmin } from '../lib/supabaseAdmin.js'

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
  const prompt = [
    'Kullanıcının CEO sorularına ilk taslak cevaplarını üret.',
    'Kısa, net, iş odaklı ve uygulanabilir cevaplar ver.',
    'Sadece JSON döndür.',
    'JSON schema:',
    '{"answers":[{"position":1,"suggestedAnswer":"...","confidence":0.84}]}',
    '',
    'Kullanıcı isteği:',
    job.request_text ?? '',
    '',
    'Varsa mevcut cevap JSON:',
    job.answers_json ? JSON.stringify(job.answers_json) : '{}',
    '',
    'Varsa plan JSON:',
    planText || '{}',
    '',
    'Sorular:',
    ...questions.map((q, index) => `${index + 1}. ${q}`)
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
    const text = a.suggestedAnswer ?? (a as Record<string, unknown>)['suggested_answer'] as string | undefined
    return {
      position: typeof a.position === 'number' ? a.position : idx + 1,
      suggested_answer: typeof text === 'string' ? text.trim() : '',
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
        suggested_answer: match?.suggested_answer || '',
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

export default router
