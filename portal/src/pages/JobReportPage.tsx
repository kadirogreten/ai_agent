import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { supabase } from '@/lib/supabaseClient'
import { useAuthStore } from '@/stores/authStore'

// ── Types ────────────────────────────────────────────────────────────────────

type ImageContent = {
  url: string
  type: 'dalle' | 'wikimedia' | 'map' | string
  source: string
  alt?: string
  title?: string
  expiring?: boolean
  locations?: Array<{ name: string; lat: number; lon: number }>
}

type JobRow = {
  id: string
  status: string
  mode: string
  domain_pack: string | null
  request_text: string | null
  result_json: {
    run_id?: string
    playbook_run_ids?: string[]
  } | null
  created_at: string
}

type RunOutput = {
  id: string
  run_id: string
  step_id: string | null
  agent_id: string | null
  artifact_name: string | null
  output_type: string
  content_md: string | null
  content_json: unknown | null
  created_at: string
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function collectRunIds(job: JobRow | null): string[] {
  if (!job?.result_json) return []
  const ids = new Set<string>()
  if (job.result_json.run_id) ids.add(job.result_json.run_id)
  for (const id of job.result_json.playbook_run_ids ?? []) {
    if (id) ids.add(id)
  }
  return [...ids]
}

function outputBody(o: RunOutput): string | null {
  if (o.content_md?.trim()) return o.content_md
  if (o.content_json != null) {
    try { return JSON.stringify(o.content_json, null, 2) }
    catch { return String(o.content_json) }
  }
  return null
}

// ── Markdown renderer ─────────────────────────────────────────────────────────

function inlineBold(text: string) {
  const parts = text.split(/\*\*(.+?)\*\*/)
  return parts.map((part, i) =>
    i % 2 === 1
      ? <strong key={i} style={{ fontWeight: 700 }}>{part}</strong>
      : part
  )
}

function renderMd(md: string) {
  const elements: React.ReactNode[] = []
  const lines = md.split('\n')
  let i = 0
  while (i < lines.length) {
    const raw = lines[i]
    const line = raw.trimEnd()

    if (/^### /.test(line)) {
      elements.push(<h3 key={i} className="report-h3">{line.slice(4)}</h3>)
    } else if (/^## /.test(line)) {
      elements.push(<h2 key={i} className="report-h2">{line.slice(3)}</h2>)
    } else if (/^# /.test(line)) {
      elements.push(<h1 key={i} className="report-h1">{line.slice(2)}</h1>)
    } else if (/^[-*] /.test(line)) {
      // Collect consecutive bullet lines
      const bullets: string[] = []
      while (i < lines.length && /^[-*] /.test(lines[i].trimEnd())) {
        bullets.push(lines[i].trimEnd().slice(2))
        i++
      }
      elements.push(
        <ul key={i} className="report-ul">
          {bullets.map((b, bi) => <li key={bi}>{inlineBold(b)}</li>)}
        </ul>
      )
      continue
    } else if (/^\d+\. /.test(line)) {
      // Collect ordered list
      const items: string[] = []
      while (i < lines.length && /^\d+\. /.test(lines[i].trimEnd())) {
        items.push(lines[i].trimEnd().replace(/^\d+\.\s*/, ''))
        i++
      }
      elements.push(
        <ol key={i} className="report-ol">
          {items.map((b, bi) => <li key={bi}>{inlineBold(b)}</li>)}
        </ol>
      )
      continue
    } else if (/^```/.test(line)) {
      // Code block
      const codeLines: string[] = []
      i++
      while (i < lines.length && !/^```/.test(lines[i])) {
        codeLines.push(lines[i])
        i++
      }
      elements.push(
        <pre key={i} className="report-pre"><code>{codeLines.join('\n')}</code></pre>
      )
    } else if (!line.trim()) {
      elements.push(<div key={i} style={{ height: '0.6em' }} />)
    } else {
      elements.push(<p key={i} className="report-p">{inlineBold(line)}</p>)
    }
    i++
  }
  return elements
}

// ── Print + report styles ─────────────────────────────────────────────────────

const STYLES = `
  .report-root {
    font-family: 'Georgia', 'Times New Roman', serif;
    color: #1a1a1a;
    line-height: 1.75;
  }
  .report-page {
    background: #fff;
    max-width: 780px;
    margin: 0 auto;
    padding: 0 0 64px 0;
  }
  /* Cover */
  .report-cover {
    background: linear-gradient(135deg, #1a1a2e 0%, #16213e 60%, #0f3460 100%);
    color: #fff;
    padding: 64px 56px 56px;
    border-radius: 0 0 2px 2px;
    margin-bottom: 48px;
  }
  .report-cover-label {
    font-size: 11px;
    letter-spacing: 3px;
    text-transform: uppercase;
    color: rgba(255,255,255,0.5);
    margin-bottom: 20px;
    font-family: 'Arial', sans-serif;
  }
  .report-cover-title {
    font-size: 28px;
    font-weight: 700;
    line-height: 1.3;
    margin-bottom: 32px;
    max-width: 560px;
  }
  .report-cover-meta {
    display: flex;
    flex-wrap: wrap;
    gap: 24px;
    font-size: 13px;
    color: rgba(255,255,255,0.65);
    font-family: 'Arial', sans-serif;
    border-top: 1px solid rgba(255,255,255,0.15);
    padding-top: 24px;
    margin-top: 8px;
  }
  .report-cover-meta-item strong {
    color: rgba(255,255,255,0.9);
    display: block;
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 1px;
    margin-bottom: 3px;
  }
  /* Body */
  .report-body {
    padding: 0 56px;
  }
  /* Request block */
  .report-request {
    background: #f8f7f4;
    border-left: 4px solid #0f3460;
    padding: 20px 24px;
    border-radius: 0 6px 6px 0;
    margin-bottom: 40px;
  }
  .report-request-label {
    font-size: 11px;
    letter-spacing: 2px;
    text-transform: uppercase;
    color: #0f3460;
    font-family: 'Arial', sans-serif;
    margin-bottom: 10px;
    font-weight: 700;
  }
  .report-request-text {
    font-size: 15px;
    line-height: 1.7;
    color: #2d2d2d;
    white-space: pre-wrap;
  }
  /* Section */
  .report-section {
    margin-bottom: 48px;
    page-break-inside: avoid;
  }
  .report-section-header {
    display: flex;
    align-items: flex-start;
    gap: 16px;
    margin-bottom: 20px;
    padding-bottom: 14px;
    border-bottom: 2px solid #eee;
  }
  .report-section-num {
    width: 32px;
    height: 32px;
    background: #0f3460;
    color: white;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 13px;
    font-weight: 700;
    font-family: 'Arial', sans-serif;
    flex-shrink: 0;
    margin-top: 2px;
  }
  .report-section-title {
    font-size: 19px;
    font-weight: 700;
    color: #1a1a2e;
    line-height: 1.3;
  }
  .report-section-agent {
    font-size: 12px;
    color: #888;
    font-family: 'Arial', sans-serif;
    margin-top: 3px;
  }
  .report-section-time {
    font-size: 11px;
    color: #bbb;
    font-family: 'Arial', sans-serif;
    margin-left: auto;
    flex-shrink: 0;
    padding-top: 6px;
  }
  .report-section-runid {
    font-size: 10px;
    color: #ccc;
    font-family: monospace;
    margin-bottom: 16px;
  }
  /* Content */
  .report-h1 { font-size: 22px; font-weight: 700; color: #1a1a2e; margin: 28px 0 10px; }
  .report-h2 { font-size: 18px; font-weight: 700; color: #16213e; margin: 22px 0 8px; border-bottom: 1px solid #e5e5e5; padding-bottom: 4px; }
  .report-h3 { font-size: 15px; font-weight: 700; color: #0f3460; margin: 18px 0 6px; }
  .report-p  { font-size: 14.5px; color: #2d2d2d; margin: 0 0 10px; }
  .report-ul { margin: 8px 0 14px 20px; padding: 0; list-style: disc; }
  .report-ol { margin: 8px 0 14px 20px; padding: 0; list-style: decimal; }
  .report-ul li, .report-ol li { font-size: 14.5px; color: #2d2d2d; margin-bottom: 4px; }
  .report-pre {
    background: #f5f5f5;
    border: 1px solid #e0e0e0;
    border-radius: 6px;
    padding: 16px;
    font-size: 12.5px;
    overflow-x: auto;
    margin: 12px 0 16px;
    line-height: 1.5;
    color: #333;
    font-family: 'Consolas', 'Monaco', monospace;
  }
  /* Toolbar */
  .report-toolbar {
    background: #1a1a2e;
    padding: 12px 56px;
    display: flex;
    align-items: center;
    gap: 10px;
    position: sticky;
    top: 0;
    z-index: 100;
    border-bottom: 1px solid rgba(255,255,255,0.08);
  }
  .report-toolbar-btn {
    font-family: 'Arial', sans-serif;
    font-size: 13px;
    padding: 6px 14px;
    border-radius: 6px;
    border: 1px solid rgba(255,255,255,0.2);
    background: rgba(255,255,255,0.07);
    color: rgba(255,255,255,0.85);
    cursor: pointer;
    transition: background 0.15s;
  }
  .report-toolbar-btn:hover { background: rgba(255,255,255,0.14); }
  .report-toolbar-btn:disabled { opacity: 0.4; cursor: default; }
  .report-toolbar-title {
    font-family: 'Arial', sans-serif;
    font-size: 13px;
    color: rgba(255,255,255,0.4);
    margin-left: 8px;
  }
  /* Empty / loading */
  .report-empty {
    text-align: center;
    padding: 80px 0;
    color: #999;
    font-family: 'Arial', sans-serif;
    font-size: 14px;
  }
  /* Print */
  @media print {
    .report-toolbar { display: none !important; }
    .report-root { background: white; }
    .report-cover { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .report-section-num { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .report-page { padding-bottom: 0; }
    @page { margin: 1.5cm 2cm; }
    .report-section { page-break-inside: avoid; }
  }
`

// ── Component ─────────────────────────────────────────────────────────────────

export default function JobReportPage() {
  const { jobId } = useParams()
  const navigate = useNavigate()
  const session = useAuthStore((s) => s.session)

  const [job, setJob] = useState<JobRow | null>(null)
  const [outputs, setOutputs] = useState<RunOutput[]>([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)
  const [downloading, setDownloading] = useState(false)
  const [generatingVisuals, setGeneratingVisuals] = useState(false)
  const [visualNotice, setVisualNotice] = useState<string | null>(null)

  // Inject styles
  useEffect(() => {
    const el = document.createElement('style')
    el.textContent = STYLES
    document.head.appendChild(el)
    return () => { document.head.removeChild(el) }
  }, [])

  const load = useCallback(async () => {
    if (!jobId) return
    setErr(null)
    setLoading(true)

    const jobRes = await supabase
      .from('run_requests')
      .select('id,status,mode,domain_pack,request_text,result_json,created_at')
      .eq('id', jobId)
      .maybeSingle()

    if (jobRes.error) { setErr(jobRes.error.message); setLoading(false); return }
    const row = (jobRes.data ?? null) as unknown as JobRow | null
    setJob(row)

    const runIds = collectRunIds(row)
    if (runIds.length > 0) {
      const outRes = await supabase
        .from('run_outputs')
        .select('id,run_id,step_id,agent_id,artifact_name,output_type,content_md,content_json,created_at')
        .in('run_id', runIds)
        .order('created_at', { ascending: true })
      if (!outRes.error) setOutputs((outRes.data ?? []) as RunOutput[])
    } else {
      setOutputs([])
    }
    setLoading(false)
  }, [jobId])

  useEffect(() => { load() }, [load])

  const shouldPoll = useMemo(() => job?.status === 'pending' || job?.status === 'running', [job?.status])
  useEffect(() => {
    if (!shouldPoll) return
    const id = window.setInterval(() => load(), 5000)
    return () => window.clearInterval(id)
  }, [load, shouldPoll])

  async function generateVisuals() {
    if (!session?.access_token || !jobId) return
    setGeneratingVisuals(true)
    setVisualNotice(null)
    try {
      const res = await fetch(`/api/ceo/jobs/${jobId}/generate-visuals`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
      })
      const json = await res.json().catch(() => null)
      if (!res.ok) throw new Error(json?.error ?? `HTTP ${res.status}`)
      const count = json?.count ?? 0
      setVisualNotice(`${count} görsel oluşturuldu. Sayfa yenileniyor…`)
      setTimeout(() => { load(); setVisualNotice(null) }, 1500)
    } catch (e) {
      setVisualNotice('Görsel oluşturma hatası: ' + (e instanceof Error ? e.message : String(e)))
    } finally {
      setGeneratingVisuals(false)
    }
  }

  async function downloadDocx() {
    if (!session?.access_token || !jobId) return
    setDownloading(true)
    try {
      const res = await fetch(`/api/ceo/jobs/${jobId}/report.docx`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
      })
      if (!res.ok) {
        const json = await res.json().catch(() => null)
        throw new Error(json?.error ?? `HTTP ${res.status}`)
      }
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `agentarmy-raporu-${jobId.slice(0, 8)}.docx`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
    } catch (e) {
      alert('Word indirme hatası: ' + (e instanceof Error ? e.message : String(e)))
    } finally {
      setDownloading(false)
    }
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="report-root" style={{ background: '#f4f4f0', minHeight: '100vh' }}>
        <div className="report-empty">Yükleniyor…</div>
      </div>
    )
  }

  const domainLabel = job?.domain_pack
    ? job.domain_pack.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
    : 'AgentArmy'

  return (
    <div className="report-root" style={{ background: '#f0ede8', minHeight: '100vh' }}>

      {/* Toolbar */}
      <div className="report-toolbar">
        <button className="report-toolbar-btn" onClick={() => navigate(-1)}>← Geri</button>
        <button className="report-toolbar-btn" onClick={() => window.print()}>🖨 PDF</button>
        <button className="report-toolbar-btn" onClick={downloadDocx} disabled={downloading}>
          {downloading ? 'İndiriliyor…' : '⬇ Word'}
        </button>
        <button
          className="report-toolbar-btn"
          onClick={generateVisuals}
          disabled={generatingVisuals || !job || job.status !== 'success'}
          style={{ borderColor: 'rgba(251,191,36,0.4)', color: 'rgba(251,191,36,0.9)' }}
        >
          {generatingVisuals ? '⏳ Oluşturuluyor…' : '🎨 Görsel Oluştur'}
        </button>
        <button className="report-toolbar-btn" onClick={load}>↻ Yenile</button>
        <span className="report-toolbar-title">
          {job?.domain_pack ?? 'Rapor'} · {outputs.filter(o => o.output_type !== 'image').length} bölüm
        </span>
      </div>

      {visualNotice ? (
        <div style={{ padding: '10px 56px', background: '#1a1a2e', fontFamily: 'Arial', fontSize: 13, color: 'rgba(251,191,36,0.9)', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
          {visualNotice}
        </div>
      ) : null}

      {err ? (
        <div style={{ padding: '24px 56px', color: '#c00', fontFamily: 'Arial', fontSize: 13 }}>{err}</div>
      ) : null}

      <div className="report-page">

        {/* Cover */}
        <div className="report-cover">
          <div className="report-cover-label">AgentArmy · Araştırma Raporu</div>
          <div className="report-cover-title">
            {job?.request_text
              ? job.request_text.slice(0, 120) + (job.request_text.length > 120 ? '…' : '')
              : domainLabel}
          </div>
          <div className="report-cover-meta">
            <div className="report-cover-meta-item">
              <strong>Domain Pack</strong>
              {job?.domain_pack ?? '-'}
            </div>
            <div className="report-cover-meta-item">
              <strong>Mod</strong>
              {job?.mode ?? '-'}
            </div>
            <div className="report-cover-meta-item">
              <strong>Oluşturuldu</strong>
              {job ? new Date(job.created_at).toLocaleDateString('tr-TR', {
                day: 'numeric', month: 'long', year: 'numeric',
              }) : '-'}
            </div>
            <div className="report-cover-meta-item">
              <strong>Bölüm</strong>
              {outputs.length} adım çıktısı
            </div>
          </div>
        </div>

        <div className="report-body">

          {/* Request */}
          {job?.request_text ? (
            <div className="report-request">
              <div className="report-request-label">Araştırma İsteği</div>
              <div className="report-request-text">{job.request_text}</div>
            </div>
          ) : null}

          {/* Separate image vs text outputs */}
          {(() => {
            const imageOutputs = outputs.filter(o => o.output_type === 'image')
            const textOutputs  = outputs.filter(o => o.output_type !== 'image')

            return (
              <>
                {/* Empty state */}
                {textOutputs.length === 0 ? (
                  <div className="report-empty">
                    {job?.status === 'running' || job?.status === 'pending'
                      ? 'Job hâlâ çalışıyor, çıktılar bekleniyor…'
                      : 'Bu job için kayıtlı metin çıktısı yok.'}
                  </div>
                ) : null}

                {/* Text sections */}
                {textOutputs.map((o, idx) => {
                  const title = o.artifact_name ?? o.step_id ?? o.output_type
                  const body = outputBody(o)
                  const isCode = body ? /^```/.test(body) : false
                  const cleanBody = isCode
                    ? body!.replace(/^```[^\n]*\n?/, '').replace(/\n?```$/, '')
                    : body

                  return (
                    <div key={o.id} className="report-section">
                      <div className="report-section-header">
                        <div className="report-section-num">{idx + 1}</div>
                        <div style={{ flex: 1 }}>
                          <div className="report-section-title">{title}</div>
                          {o.agent_id ? <div className="report-section-agent">{o.agent_id}</div> : null}
                        </div>
                        <div className="report-section-time">
                          {new Date(o.created_at).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })}
                        </div>
                      </div>
                      <div className="report-section-runid">{o.run_id}</div>
                      {body ? (
                        isCode ? <pre className="report-pre"><code>{cleanBody}</code></pre>
                               : <div>{renderMd(body)}</div>
                      ) : (
                        <p className="report-p" style={{ color: '#aaa', fontStyle: 'italic' }}>Boş içerik</p>
                      )}
                    </div>
                  )
                })}

                {/* Image gallery */}
                {imageOutputs.length > 0 ? (
                  <div className="report-section" style={{ marginTop: 48 }}>
                    <div className="report-section-header">
                      <div className="report-section-num" style={{ background: '#7c3aed' }}>🖼</div>
                      <div style={{ flex: 1 }}>
                        <div className="report-section-title">Görsel Galeri</div>
                        <div className="report-section-agent">{imageOutputs.length} görsel</div>
                      </div>
                    </div>

                    {/* Map first if present */}
                    {imageOutputs.filter(o => (o.content_json as ImageContent | null)?.type === 'map').map(o => {
                      const img = o.content_json as ImageContent
                      return (
                        <div key={o.id} style={{ marginBottom: 24 }}>
                          <div style={{ fontSize: 12, fontFamily: 'Arial', color: '#888', marginBottom: 8, display: 'flex', justifyContent: 'space-between' }}>
                            <span>🗺 Coğrafi Harita</span>
                            <span style={{ fontSize: 11 }}>{img.source}</span>
                          </div>
                          <img
                            src={img.url} alt={img.alt ?? 'Harita'}
                            style={{ width: '100%', borderRadius: 8, border: '1px solid #e0e0e0', display: 'block' }}
                            onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
                          />
                          {(img.locations && img.locations.length > 0) ? (
                            <div style={{ fontSize: 11, color: '#999', fontFamily: 'Arial', marginTop: 6 }}>
                              {img.locations.map(l => l.name).join(' · ')}
                            </div>
                          ) : null}
                        </div>
                      )
                    })}

                    {/* DALL-E image */}
                    {imageOutputs.filter(o => (o.content_json as ImageContent | null)?.type === 'dalle').map(o => {
                      const img = o.content_json as ImageContent
                      return (
                        <div key={o.id} style={{ marginBottom: 24 }}>
                          <div style={{ fontSize: 12, fontFamily: 'Arial', color: '#888', marginBottom: 8, display: 'flex', justifyContent: 'space-between' }}>
                            <span>🤖 AI İllüstrasyon</span>
                            <span style={{ fontSize: 11, color: '#e2814a' }}>
                              {img.source}{img.expiring ? ' · URL geçici (1-2 saat)' : ''}
                            </span>
                          </div>
                          <img
                            src={img.url} alt={img.alt ?? 'AI görseli'}
                            style={{ width: '100%', borderRadius: 8, border: '1px solid #e0e0e0', display: 'block' }}
                            onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
                          />
                        </div>
                      )
                    })}

                    {/* Wikimedia grid */}
                    {(() => {
                      const wikiOutputs = imageOutputs.filter(o => (o.content_json as ImageContent | null)?.type === 'wikimedia')
                      if (wikiOutputs.length === 0) return null
                      return (
                        <>
                          <div style={{ fontSize: 12, fontFamily: 'Arial', color: '#888', marginBottom: 10 }}>
                            📷 Gerçek Fotoğraflar ({wikiOutputs.length}) — Wikimedia Commons
                          </div>
                          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 12, marginBottom: 16 }}>
                            {wikiOutputs.map(o => {
                              const img = o.content_json as ImageContent
                              return (
                                <div key={o.id} style={{ borderRadius: 8, overflow: 'hidden', border: '1px solid #e0e0e0', background: '#fafafa' }}>
                                  <img
                                    src={img.url} alt={img.alt ?? img.title ?? ''}
                                    style={{ width: '100%', height: 160, objectFit: 'cover', display: 'block' }}
                                    onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
                                  />
                                  {img.title ? (
                                    <div style={{ padding: '6px 8px', fontSize: 11, color: '#666', fontFamily: 'Arial', lineHeight: 1.3 }}>
                                      {img.title.slice(0, 80)}
                                    </div>
                                  ) : null}
                                </div>
                              )
                            })}
                          </div>
                        </>
                      )
                    })()}
                  </div>
                ) : null}
              </>
            )
          })()}

          {/* Footer */}
          {outputs.length > 0 ? (
            <div style={{
              borderTop: '1px solid #ddd',
              paddingTop: 24,
              marginTop: 40,
              textAlign: 'center',
              fontFamily: 'Arial',
              fontSize: 12,
              color: '#aaa',
            }}>
              AgentArmy · {domainLabel} · {new Date().toLocaleDateString('tr-TR')}
            </div>
          ) : null}

        </div>
      </div>
    </div>
  )
}
