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

async function readQuestionsFromJob(job: JobRow) {
  const runDir = extractRunDir(job.result_json)
  if (!runDir) {
    return { runDir: null, questions: [] as string[], planText: '' }
  }

  const qPath = path.join(runDir, 'questions.md')
  const planPath = path.join(runDir, 'plan.json')

  const questionsText = await fs.readFile(qPath, 'utf8').catch(() => '')
  const planText = await fs.readFile(planPath, 'utf8').catch(() => '')

  const questions = questionsText
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('- '))
    .map((line) => line.slice(2).trim())
    .filter(Boolean)

  return { runDir, questions, planText }
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
    answers?: Array<{ position?: number; suggestedAnswer?: string; confidence?: number }>
  }

  return (parsed.answers ?? []).map((a, idx) => ({
    position: typeof a.position === 'number' ? a.position : idx + 1,
    suggested_answer: typeof a.suggestedAnswer === 'string' ? a.suggestedAnswer.trim() : '',
    confidence: typeof a.confidence === 'number' ? a.confidence : null,
  }))
}

router.get('/jobs/:jobId/review', async (req: Request, res: Response) => {
  try {
    const { supabase, user } = await getAuthedUser(req)
    const job = await getOwnedJob(supabase, user.id, req.params.jobId)
    const questionData = await readQuestionsFromJob(job)
    const reviews = await loadReviews(supabase, user.id, job.id)

    const merged = questionData.questions.map((question, index) => {
      const row = reviews.find((r) => r.position === index + 1)
      return {
        position: index + 1,
        question,
        suggested_answer: row?.suggested_answer ?? null,
        user_answer: row?.user_answer ?? null,
        status: row?.status ?? 'suggested',
        confidence: row?.confidence ?? null,
      }
    })

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
    const message = e instanceof Error ? e.message : 'Review fetch failed'
    res.status(500).json({ success: false, error: message })
  }
})

router.post('/jobs/:jobId/review/generate', async (req: Request, res: Response) => {
  try {
    const { supabase, user } = await getAuthedUser(req)
    const job = await getOwnedJob(supabase, user.id, req.params.jobId)
    const { questions, planText } = await readQuestionsFromJob(job)
    if (questions.length === 0) {
      res.status(200).json({ success: true, reviews: [] })
      return
    }

    const suggested = await generateSuggestedAnswers(job, questions, planText)
    const existing = await loadReviews(supabase, user.id, job.id)
    const payload = questions.map((question, index) => {
      const match = suggested.find((x) => x.position === index + 1)
      const current = existing.find((x) => x.position === index + 1)
      return {
        owner_user_id: user.id,
        job_id: job.id,
        position: index + 1,
        question,
        suggested_answer: match?.suggested_answer || '',
        user_answer: current?.user_answer ?? null,
        status: current?.status ?? 'suggested',
        confidence: match?.confidence ?? null,
      }
    })

    const upserted = await supabase
      .from('ceo_question_reviews')
      .upsert(payload, { onConflict: 'job_id,position' })
      .select('id,job_id,position,question,suggested_answer,user_answer,status,confidence,updated_at')
      .order('position', { ascending: true })

    if (upserted.error) throw upserted.error
    res.status(200).json({ success: true, reviews: upserted.data ?? [] })
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'Suggestion generation failed'
    res.status(500).json({ success: false, error: message })
  }
})

router.post('/jobs/:jobId/review', async (req: Request, res: Response) => {
  try {
    const { supabase, user } = await getAuthedUser(req)
    const job = await getOwnedJob(supabase, user.id, req.params.jobId)
    const items = Array.isArray(req.body?.items) ? req.body.items : []
    const { questions } = await readQuestionsFromJob(job)
    const existing = await loadReviews(supabase, user.id, job.id)

    const payload = questions.map((question, index) => {
      const position = index + 1
      const incoming = items.find((item) => item && typeof item === 'object' && item.position === position) as
        | { user_answer?: string; status?: string }
        | undefined
      const current = existing.find((row) => row.position === position)
      const userAnswer = typeof incoming?.user_answer === 'string'
        ? incoming.user_answer
        : (current?.user_answer ?? null)
      const status = typeof incoming?.status === 'string'
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

    if (payload.length > 0) {
      const upserted = await supabase
        .from('ceo_question_reviews')
        .upsert(payload, { onConflict: 'job_id,position' })

      if (upserted.error) throw upserted.error
    }

    const reviews = await loadReviews(supabase, user.id, job.id)
    res.status(200).json({ success: true, reviews })
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'Review save failed'
    res.status(500).json({ success: false, error: message })
  }
})

router.post('/jobs/:jobId/review/iterate', async (req: Request, res: Response) => {
  try {
    const { supabase, user } = await getAuthedUser(req)
    const job = await getOwnedJob(supabase, user.id, req.params.jobId)
    const reviews = await loadReviews(supabase, user.id, job.id)

    const answers = reviews.reduce<Record<string, string>>((acc, row) => {
      const finalAnswer = (row.user_answer && row.user_answer.trim()) || (row.suggested_answer && row.suggested_answer.trim()) || ''
      if (finalAnswer) {
        acc[row.question] = finalAnswer
      }
      return acc
    }, {})

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
    const message = e instanceof Error ? e.message : 'Iterate job creation failed'
    res.status(500).json({ success: false, error: message })
  }
})

export default router
