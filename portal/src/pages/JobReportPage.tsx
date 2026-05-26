import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { supabase } from '@/lib/supabaseClient'
import { useAuthStore } from '@/stores/authStore'
import { listAgents } from '@/lib/agents'
import type { AgentRow } from '@/lib/agents'
import {
  Chart as ChartJS,
  CategoryScale, LinearScale, BarElement, LineElement, PointElement,
  ArcElement, RadialLinearScale, Title, Tooltip, Legend, Filler,
} from 'chart.js'
import { Bar, Line, Pie, Doughnut, PolarArea } from 'react-chartjs-2'

ChartJS.register(
  CategoryScale, LinearScale, BarElement, LineElement, PointElement,
  ArcElement, RadialLinearScale, Title, Tooltip, Legend, Filler,
)

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
    // If content_json is an object with known text fields, extract the markdown directly
    if (typeof o.content_json === 'object' && o.content_json !== null && !Array.isArray(o.content_json)) {
      const obj = o.content_json as Record<string, unknown>
      for (const key of ['work', 'content', 'text', 'md', 'markdown', 'report', 'output', 'result']) {
        if (typeof obj[key] === 'string' && (obj[key] as string).trim()) {
          return obj[key] as string
        }
      }
    }
    try { return JSON.stringify(o.content_json, null, 2) }
    catch { return String(o.content_json) }
  }
  return null
}

// ── Image helper components ───────────────────────────────────────────────────

function FailsafeImage({
  img, label, labelRight,
}: {
  img: ImageContent
  label: string
  labelRight?: React.ReactNode
}) {
  const [failed, setFailed] = useState(false)
  return (
    <div style={{ marginBottom: 24 }}>
      <div style={{ fontSize: 12, fontFamily: 'Arial', color: '#888', marginBottom: 8, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span>{label}</span>
        {labelRight}
      </div>
      {failed ? (
        <div style={{ width: '100%', background: '#f5f5f5', border: '1px dashed #ccc', borderRadius: 8, padding: '24px 16px', textAlign: 'center', fontFamily: 'Arial', fontSize: 12, color: '#999' }}>
          ⚠️ Görsel yüklenemedi — URL geçmiş veya kaynak erişilemiyor<br />
          <a href={img.url} target="_blank" rel="noreferrer" style={{ color: '#0f3460', fontSize: 11, marginTop: 4, display: 'inline-block' }}>Doğrudan aç →</a>
        </div>
      ) : (
        <img
          src={img.url}
          alt={img.alt ?? label}
          style={{ width: '100%', borderRadius: 8, border: '1px solid #e0e0e0', display: 'block' }}
          onError={() => setFailed(true)}
        />
      )}
    </div>
  )
}

function MapImage({ img }: { img: ImageContent }) {
  // Track which URL sources have failed so we cascade through fallbacks
  const [urlIndex, setUrlIndex] = useState(0)

  const locations = img.locations ?? []
  const avgLat = locations.length > 0 ? locations.reduce((s, l) => s + l.lat, 0) / locations.length : 39.5
  const avgLon = locations.length > 0 ? locations.reduce((s, l) => s + l.lon, 0) / locations.length : 35.0
  const zoom   = locations.length === 0 ? 6 : locations.length <= 2 ? 8 : 7

  // Ordered list of fallback map sources — try each in turn
  const imgSources = [
    // 1. Wikimedia Maps (reliable, no key needed)
    `https://maps.wikimedia.org/img/osm-intl,${zoom},${avgLat.toFixed(4)},${avgLon.toFixed(4)},800x400.png`,
    // 2. Original URL stored in DB (OSM static, sometimes works)
    img.url,
  ]

  // OSM embed iframe as final fallback (always works in browser)
  const spread = zoom <= 6 ? 5 : zoom <= 7 ? 3 : 1.5
  const embedUrl = `https://www.openstreetmap.org/export/embed.html?bbox=${(avgLon - spread).toFixed(3)},${(avgLat - spread * 0.6).toFixed(3)},${(avgLon + spread).toFixed(3)},${(avgLat + spread * 0.6).toFixed(3)}&layer=mapnik`

  const allFailed = urlIndex >= imgSources.length

  return (
    <div style={{ marginBottom: 24 }}>
      <div style={{ fontSize: 12, fontFamily: 'Arial', color: '#888', marginBottom: 8, display: 'flex', justifyContent: 'space-between' }}>
        <span>🗺 Coğrafi Harita</span>
        <span style={{ fontSize: 11 }}>
          {allFailed ? 'OpenStreetMap (embed)' : urlIndex === 0 ? 'Wikimedia Maps' : img.source}
        </span>
      </div>

      {allFailed ? (
        // Final fallback: OSM embed iframe (interactive, always loads)
        <iframe
          src={embedUrl}
          title="Coğrafi Harita"
          style={{ width: '100%', height: 360, borderRadius: 8, border: '1px solid #e0e0e0', display: 'block' }}
          loading="lazy"
        />
      ) : (
        <img
          key={urlIndex}
          src={imgSources[urlIndex]}
          alt={img.alt ?? 'Harita'}
          style={{ width: '100%', borderRadius: 8, border: '1px solid #e0e0e0', display: 'block' }}
          onError={() => setUrlIndex(i => i + 1)}
        />
      )}

      {locations.length > 0 ? (
        <div style={{ fontSize: 11, color: '#999', fontFamily: 'Arial', marginTop: 6 }}>
          {locations.map(l => l.name).join(' · ')}
        </div>
      ) : null}
    </div>
  )
}

function WikiCard({ img }: { img: ImageContent }) {
  const [failed, setFailed] = useState(false)
  return (
    <div style={{ borderRadius: 8, overflow: 'hidden', border: '1px solid #e0e0e0', background: '#fafafa' }}>
      {failed ? (
        <div style={{ height: 160, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f0f0f0', fontSize: 11, color: '#aaa', fontFamily: 'Arial' }}>
          Yüklenemedi
        </div>
      ) : (
        <img
          src={img.url}
          alt={img.alt ?? img.title ?? ''}
          style={{ width: '100%', height: 160, objectFit: 'cover', display: 'block' }}
          onError={() => setFailed(true)}
        />
      )}
      {img.title ? (
        <div style={{ padding: '6px 8px', fontSize: 11, color: '#666', fontFamily: 'Arial', lineHeight: 1.3 }}>
          {img.title.slice(0, 80)}
        </div>
      ) : null}
    </div>
  )
}

// ── Chart.js palette & renderer ──────────────────────────────────────────────

const CHART_COLORS = [
  '#0f3460', '#1a6fa8', '#2196f3', '#64b5f6',
  '#0d7377', '#14a085', '#43c6ac', '#88d8b0',
  '#6a3093', '#a044ff', '#c471ed', '#f64f59',
  '#f7971e', '#ffd200', '#f9a825',
]

function chartColor(i: number, alpha = 1) {
  const hex = CHART_COLORS[i % CHART_COLORS.length]
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  return `rgba(${r},${g},${b},${alpha})`
}

type ChartConfig = {
  type: 'bar' | 'line' | 'pie' | 'doughnut' | 'polarArea'
  title: string
  labels: string[]
  datasets: Array<{ label?: string; data: number[] }>
}

const chartOptions = (title: string) => ({
  responsive: true,
  plugins: {
    legend: { position: 'bottom' as const, labels: { font: { family: 'Arial', size: 12 }, padding: 16 } },
    title: { display: true, text: title, font: { family: 'Arial', size: 14, weight: 'bold' as const }, color: '#1a1a2e', padding: { bottom: 16 } },
    tooltip: { backgroundColor: 'rgba(15,52,96,0.9)', titleFont: { family: 'Arial' }, bodyFont: { family: 'Arial' }, padding: 10, cornerRadius: 6 },
  },
  scales: {},
})

const barLineOptions = (title: string) => ({
  ...chartOptions(title),
  scales: {
    x: { ticks: { font: { family: 'Arial', size: 11 }, color: '#555' }, grid: { color: 'rgba(0,0,0,0.04)' } },
    y: { ticks: { font: { family: 'Arial', size: 11 }, color: '#555' }, grid: { color: 'rgba(0,0,0,0.06)' }, beginAtZero: true },
  },
})

function SingleChart({ cfg, idx }: { cfg: ChartConfig; idx: number }) {
  const colors     = cfg.labels.map((_, i) => chartColor(i))
  const colorsFill = cfg.labels.map((_, i) => chartColor(i, 0.75))

  const data = {
    labels: cfg.labels,
    datasets: cfg.datasets.map((ds, di) => {
      const base = { label: ds.label ?? cfg.title, data: ds.data }
      if (cfg.type === 'bar') {
        return { ...base, backgroundColor: colorsFill, borderColor: colors, borderWidth: 1.5, borderRadius: 4 }
      }
      if (cfg.type === 'line') {
        const c = chartColor(di)
        return { ...base, borderColor: c, backgroundColor: chartColor(di, 0.12), fill: true, tension: 0.4, pointRadius: 4, pointBackgroundColor: c }
      }
      return { ...base, backgroundColor: colorsFill, borderColor: colors, borderWidth: 2 }
    }),
  }

  const style = { maxHeight: 320 }

  if (cfg.type === 'bar')       return <Bar       key={idx} data={data} options={barLineOptions(cfg.title)} style={style} />
  if (cfg.type === 'line')      return <Line      key={idx} data={data} options={barLineOptions(cfg.title)} style={style} />
  if (cfg.type === 'pie')       return <Pie       key={idx} data={data} options={chartOptions(cfg.title)}   style={style} />
  if (cfg.type === 'doughnut')  return <Doughnut  key={idx} data={data} options={chartOptions(cfg.title)}   style={style} />
  if (cfg.type === 'polarArea') return <PolarArea key={idx} data={data} options={chartOptions(cfg.title)}   style={style} />
  return null
}

function ChartJsPanel({ output }: { output: RunOutput }) {
  const raw = output.content_json as { charts?: ChartConfig[] } | null
  const charts = raw?.charts ?? []
  if (charts.length === 0) return (
    <p style={{ fontFamily: 'Arial', fontSize: 13, color: '#888', fontStyle: 'italic', padding: '16px 0' }}>
      Grafik verisi bulunamadı.
    </p>
  )

  // Split: wide charts (bar/line) full width, round charts (pie/doughnut/polar) in grid
  const wide  = charts.filter(c => c.type === 'bar' || c.type === 'line')
  const round = charts.filter(c => c.type !== 'bar' && c.type !== 'line')

  return (
    <div>
      {wide.map((cfg, i) => (
        <div key={i} style={{ marginBottom: 32, background: 'white', borderRadius: 10, padding: '20px 16px', boxShadow: '0 1px 6px rgba(0,0,0,0.07)' }}>
          <SingleChart cfg={cfg} idx={i} />
        </div>
      ))}
      {round.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: `repeat(${Math.min(round.length, 2)}, 1fr)`, gap: 20 }}>
          {round.map((cfg, i) => (
            <div key={i} style={{ background: 'white', borderRadius: 10, padding: '20px 16px', boxShadow: '0 1px 6px rgba(0,0,0,0.07)' }}>
              <SingleChart cfg={cfg} idx={wide.length + i} />
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Mermaid chart renderer ────────────────────────────────────────────────────

declare global {
  interface Window {
    mermaid?: {
      initialize: (cfg: Record<string, unknown>) => void
      render: (id: string, definition: string) => Promise<{ svg: string }>
    }
  }
}

let mermaidLoading: Promise<void> | null = null

function loadMermaid(): Promise<void> {
  if (window.mermaid) return Promise.resolve()
  if (mermaidLoading) return mermaidLoading
  mermaidLoading = new Promise<void>((resolve, reject) => {
    const s = document.createElement('script')
    s.src = 'https://cdn.jsdelivr.net/npm/mermaid@10/dist/mermaid.min.js'
    s.onload = () => resolve()
    s.onerror = () => reject(new Error('Mermaid yüklenemedi'))
    document.head.appendChild(s)
  })
  return mermaidLoading
}

let mermaidCounter = 0

function MermaidChart({ code }: { code: string }) {
  const [svg, setSvg] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    const id = `mermaid-chart-${++mermaidCounter}`
    loadMermaid()
      .then(() => {
        window.mermaid!.initialize({ startOnLoad: false, theme: 'default', securityLevel: 'loose' })
        return window.mermaid!.render(id, code)
      })
      .then(({ svg: rendered }) => setSvg(rendered))
      .catch((e) => setErr(e instanceof Error ? e.message : 'Diyagram oluşturulamadı'))
  }, [code])

  if (err) {
    const numbered = code.split('\n').map((l, idx) => `${String(idx + 1).padStart(3, ' ')} | ${l}`).join('\n')
    return (
      <div style={{ margin: '16px 0 24px' }}>
        <div style={{ marginBottom: 10, padding: '10px 12px', borderRadius: 8, background: '#fff3f3', border: '1px solid rgba(220,38,38,0.25)', fontFamily: 'Arial', fontSize: 12, color: '#991b1b' }}>
          Mermaid diyagram hatası: {err}
        </div>
        <pre className="report-pre"><code>{numbered}</code></pre>
      </div>
    )
  }
  if (!svg) {
    return (
      <div style={{ padding: '20px 0', color: '#aaa', fontFamily: 'Arial', fontSize: 12, textAlign: 'center' }}>
        ⏳ Diyagram yükleniyor…
      </div>
    )
  }
  return (
    <div
      style={{ margin: '16px 0 24px', overflow: 'auto', textAlign: 'center' }}
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  )
}

// ── Markdown renderer ─────────────────────────────────────────────────────────

// Inline: **bold**, *italic*, `code`, [text](url)
function inlineMd(text: string): React.ReactNode {
  const re = /\*\*(.+?)\*\*|__(.+?)__|`([^`]+)`|\*([^*]+)\*|_([^_]+)_|\[([^\]]+)\]\(([^)]+)\)/g
  const parts: React.ReactNode[] = []
  let last = 0, m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) parts.push(text.slice(last, m.index))
    if      (m[1] != null) parts.push(<strong key={m.index}>{m[1]}</strong>)
    else if (m[2] != null) parts.push(<strong key={m.index}>{m[2]}</strong>)
    else if (m[3] != null) parts.push(<code key={m.index} className="report-code-inline">{m[3]}</code>)
    else if (m[4] != null) parts.push(<em key={m.index}>{m[4]}</em>)
    else if (m[5] != null) parts.push(<em key={m.index}>{m[5]}</em>)
    else if (m[6] != null) parts.push(<a key={m.index} href={m[7]} className="report-link" target="_blank" rel="noreferrer">{m[6]}</a>)
    last = m.index + m[0].length
  }
  if (last < text.length) parts.push(text.slice(last))
  return parts.length === 0 ? text : parts.length === 1 && typeof parts[0] === 'string' ? parts[0] : <>{parts}</>
}

// Table helpers
function isTableLine(s: string) { return s.trim().startsWith('|') && s.trim().includes('|', 1) }
function isSepLine(s: string)   { return /^\|[\s\-:|]+\|$/.test(s.trim()) }
function parseRow(s: string)    { return s.split('|').slice(1, -1).map(c => c.trim()) }

function renderMd(md: string) {
  const elements: React.ReactNode[] = []
  const lines = md.split('\n')
  let i = 0

  while (i < lines.length) {
    const raw = lines[i]
    const line = raw.trimEnd()

    // Headings
    if      (/^#### /.test(line)) { elements.push(<h4 key={i} className="report-h4">{inlineMd(line.slice(5))}</h4>); i++; continue }
    else if (/^### /.test(line))  { elements.push(<h3 key={i} className="report-h3">{inlineMd(line.slice(4))}</h3>); i++; continue }
    else if (/^## /.test(line))   { elements.push(<h2 key={i} className="report-h2">{inlineMd(line.slice(3))}</h2>); i++; continue }
    else if (/^# /.test(line))    { elements.push(<h1 key={i} className="report-h1">{inlineMd(line.slice(2))}</h1>); i++; continue }

    // Horizontal rule
    else if (/^(-{3,}|\*{3,}|_{3,})$/.test(line.trim())) {
      elements.push(<hr key={i} className="report-hr" />); i++; continue
    }

    // Blockquote
    else if (/^> /.test(line)) {
      const bqLines: string[] = []
      while (i < lines.length && /^> ?/.test(lines[i])) {
        bqLines.push(lines[i].replace(/^> ?/, '')); i++
      }
      elements.push(
        <blockquote key={i} className="report-bq">
          {bqLines.map((b, bi) => <p key={bi} className="report-p" style={{ margin: 0 }}>{inlineMd(b)}</p>)}
        </blockquote>
      ); continue
    }

    // Table: | col | col |
    else if (isTableLine(line)) {
      const tableLines: string[] = []
      while (i < lines.length && isTableLine(lines[i])) { tableLines.push(lines[i]); i++ }
      const allRows = tableLines.filter(l => !isSepLine(l))
      const [headerLine, ...dataLines] = allRows
      if (!headerLine) continue
      const headers = parseRow(headerLine)
      const rows = dataLines.map(parseRow)
      elements.push(
        <div key={i} className="report-table-wrap">
          <table className="report-table">
            <thead>
              <tr>{headers.map((h, hi) => <th key={hi}>{inlineMd(h)}</th>)}</tr>
            </thead>
            <tbody>
              {rows.map((row, ri) => (
                <tr key={ri}>
                  {headers.map((_, ci) => <td key={ci}>{inlineMd(row[ci] ?? '')}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ); continue
    }

    // Bullet list (handles both top-level "- " and indented "  - ")
    else if (/^(\s*)[-*] /.test(line)) {
      type ListItem = { text: string; depth: number }
      const items: ListItem[] = []
      while (i < lines.length && /^(\s*)[-*] /.test(lines[i])) {
        const m2 = lines[i].match(/^(\s*)[-*] (.*)$/)
        if (m2) items.push({ text: m2[2], depth: Math.floor(m2[1].length / 2) })
        i++
      }
      // Render as flat ul for now, with depth-based indent style
      elements.push(
        <ul key={i} className="report-ul">
          {items.map((b, bi) => (
            <li key={bi} style={b.depth > 0 ? { marginLeft: b.depth * 20, listStyleType: 'circle' } : undefined}>
              {inlineMd(b.text)}
            </li>
          ))}
        </ul>
      ); continue
    }

    // Ordered list
    else if (/^\d+\. /.test(line)) {
      const items: string[] = []
      while (i < lines.length && /^\d+\. /.test(lines[i].trimEnd())) { items.push(lines[i].trimEnd().replace(/^\d+\.\s*/, '')); i++ }
      elements.push(
        <ol key={i} className="report-ol">
          {items.map((b, bi) => <li key={bi}>{inlineMd(b)}</li>)}
        </ol>
      ); continue
    }

    // Code block (or Mermaid diagram)
    else if (/^\s*```/.test(raw)) {
      const fence = raw.trim()
      const lang = fence.slice(3).trim().toLowerCase().split(/\s+/)[0] ?? ''
      const codeLines: string[] = []; i++
      while (i < lines.length && !/^\s*```/.test(lines[i])) { codeLines.push(lines[i]); i++ }
      const codeText = codeLines.join('\n')
      if (lang === 'mermaid') {
        elements.push(<MermaidChart key={i} code={codeText} />)
      } else {
        elements.push(<pre key={i} className="report-pre"><code>{codeText}</code></pre>)
      }
    }

    // Empty line
    else if (!line.trim()) { elements.push(<div key={i} style={{ height: '0.5em' }} />) }

    // Paragraph
    else { elements.push(<p key={i} className="report-p">{inlineMd(line)}</p>) }

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
  .report-h4 { font-size: 13.5px; font-weight: 700; color: #444; margin: 14px 0 4px; text-transform: uppercase; letter-spacing: 0.4px; }
  .report-p  { font-size: 14.5px; color: #2d2d2d; margin: 0 0 10px; }
  .report-ul { margin: 8px 0 14px 24px; padding: 0; list-style: disc; }
  .report-ol { margin: 8px 0 14px 24px; padding: 0; list-style: decimal; }
  .report-ul li, .report-ol li { font-size: 14.5px; color: #2d2d2d; margin-bottom: 5px; line-height: 1.55; }
  .report-pre {
    background: #f5f5f5;
    border: 1px solid #e0e0e0;
    border-left: 4px solid #0f3460;
    border-radius: 0 6px 6px 0;
    padding: 16px 18px;
    font-size: 12.5px;
    overflow-x: auto;
    margin: 12px 0 16px;
    line-height: 1.55;
    color: #333;
    font-family: 'Consolas', 'Monaco', monospace;
  }
  .report-code-inline {
    background: #f0ede8;
    border: 1px solid #ddd;
    border-radius: 3px;
    padding: 1px 5px;
    font-size: 0.88em;
    font-family: 'Consolas', 'Monaco', monospace;
    color: #b44;
  }
  .report-link { color: #0f3460; text-decoration: underline; }
  .report-hr { border: none; border-top: 1px solid #ddd; margin: 22px 0; }
  .report-bq {
    border-left: 4px solid #0f3460;
    background: #f8f7f4;
    margin: 14px 0 18px;
    padding: 12px 18px;
    border-radius: 0 6px 6px 0;
    font-style: italic;
    color: #444;
  }
  /* ── Tables ── */
  .report-table-wrap {
    overflow-x: auto;
    margin: 16px 0 24px;
    border-radius: 8px;
    box-shadow: 0 1px 4px rgba(0,0,0,0.06);
  }
  .report-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 13.5px;
    font-family: 'Arial', sans-serif;
    line-height: 1.45;
  }
  .report-table thead th {
    background: #1a1a2e;
    color: #fff;
    padding: 11px 16px;
    text-align: left;
    font-weight: 600;
    font-size: 12px;
    letter-spacing: 0.3px;
    white-space: nowrap;
  }
  .report-table thead th:first-child { border-radius: 8px 0 0 0; }
  .report-table thead th:last-child  { border-radius: 0 8px 0 0; }
  .report-table tbody td {
    padding: 10px 16px;
    border-bottom: 1px solid #ece9e4;
    color: #2d2d2d;
    vertical-align: top;
  }
  .report-table tbody tr:nth-child(even) td { background: #f9f7f4; }
  .report-table tbody tr:last-child td { border-bottom: none; }
  .report-table tbody tr:last-child td:first-child { border-radius: 0 0 0 8px; }
  .report-table tbody tr:last-child td:last-child  { border-radius: 0 0 8px 0; }
  @media print {
    .report-table thead th {
      -webkit-print-color-adjust: exact; print-color-adjust: exact;
    }
    .report-table tbody tr:nth-child(even) td {
      -webkit-print-color-adjust: exact; print-color-adjust: exact;
    }
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
  /* Print — hide sidebar/shell, keep only report */
  @media print {
    /* Visibility trick: hide everything, then unhide report */
    body * { visibility: hidden !important; }
    .report-root,
    .report-root * { visibility: visible !important; }
    /* absolute (NOT fixed) so multi-page content flows correctly */
    .report-root {
      position: absolute !important;
      top: 0 !important;
      left: 0 !important;
      width: 100% !important;
      background: white !important;
    }
    .report-toolbar { display: none !important; }
    /* Force color printing */
    .report-cover,
    .report-section-num,
    .report-table thead th,
    .report-table tbody tr:nth-child(even) td {
      -webkit-print-color-adjust: exact !important;
      print-color-adjust: exact !important;
    }
    .report-page { padding-bottom: 0; max-width: 100%; }
    .report-body { padding: 0 40px; }
    @page { margin: 1.5cm 2cm; size: A4 portrait; }
    .report-section { page-break-inside: avoid; }
    /* Don't break images across pages */
    img { page-break-inside: avoid; max-width: 100%; }
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
  const [generatingSummary, setGeneratingSummary] = useState(false)
  const [summaryNotice, setSummaryNotice] = useState<string | null>(null)
  const [summaryError, setSummaryError] = useState<string | null>(null)
  const [generatingCharts, setGeneratingCharts] = useState(false)
  const [chartNotice, setChartNotice] = useState<string | null>(null)
  const [chartError, setChartError] = useState<string | null>(null)
  const [agents, setAgents] = useState<AgentRow[]>([])
  const [selectedAgentCode, setSelectedAgentCode] = useState<string>('')

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
      // Fetch text outputs (with full content) and image outputs (metadata only) separately
      // to avoid huge payloads when content_json contains large data
      const [textRes, imgRes] = await Promise.all([
        supabase
          .from('run_outputs')
          .select('id,run_id,step_id,agent_id,artifact_name,output_type,content_md,content_json,created_at')
          .in('run_id', runIds)
          .neq('output_type', 'image')
          .order('created_at', { ascending: true }),
        supabase
          .from('run_outputs')
          .select('id,run_id,step_id,agent_id,artifact_name,output_type,content_json,created_at')
          .in('run_id', runIds)
          .eq('output_type', 'image')
          .order('created_at', { ascending: true }),
      ])
      if (textRes.error) {
        console.error('[JobReportPage] text outputs fetch error:', textRes.error)
        setErr('Çıktılar yüklenirken hata: ' + textRes.error.message)
      } else {
        if (imgRes.error) {
          console.error('[JobReportPage] image outputs fetch error:', imgRes.error)
        }
        const combined = [
          ...((textRes.data ?? []) as RunOutput[]),
          ...((imgRes.data ?? []) as RunOutput[]),
        ]
        console.debug('[JobReportPage] runIds:', runIds, 'total outputs:', combined.length,
          'images:', (imgRes.data ?? []).length, 'text:', (textRes.data ?? []).length)
        setOutputs(combined)
      }
    } else {
      setOutputs([])
    }
    setLoading(false)
  }, [jobId])

  useEffect(() => { load() }, [load])

  // Load agents once for the summary agent selector
  useEffect(() => {
    listAgents({ q: '', limit: 50 }).then(({ data }) => setAgents(data))
  }, [])

  const shouldPoll = useMemo(() => job?.status === 'pending' || job?.status === 'running', [job?.status])
  useEffect(() => {
    if (!shouldPoll) return
    const id = window.setInterval(() => load(), 5000)
    return () => window.clearInterval(id)
  }, [load, shouldPoll])

  async function generateSummary() {
    if (!session?.access_token || !jobId) return
    setGeneratingSummary(true)
    setSummaryNotice(null)
    setSummaryError(null)
    try {
      const body: Record<string, string> = {}
      if (selectedAgentCode) body.agentCode = selectedAgentCode

      const res = await fetch(`/api/ceo/jobs/${jobId}/generate-summary`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const json = await res.json().catch(() => null)
      if (!res.ok) throw new Error(json?.error ?? `HTTP ${res.status}`)
      const agentUsed = json?.agentUsed ?? 'SummaryAgent'
      setSummaryNotice(`Özet oluşturuldu (${agentUsed}). Yenileniyor…`)
      setTimeout(() => { load(); setSummaryNotice(null) }, 1500)
    } catch (e) {
      setSummaryError('Özet hatası: ' + (e instanceof Error ? e.message : String(e)))
    } finally {
      setGeneratingSummary(false)
    }
  }

  async function generateCharts() {
    if (!session?.access_token || !jobId) return
    setGeneratingCharts(true)
    setChartNotice(null)
    setChartError(null)
    try {
      const res = await fetch(`/api/ceo/jobs/${jobId}/generate-charts`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
      })
      const json = await res.json().catch(() => null)
      if (!res.ok) throw new Error(json?.error ?? `HTTP ${res.status}`)
      setChartNotice('Grafikler oluşturuldu. Yenileniyor…')
      setTimeout(() => { load(); setChartNotice(null) }, 1500)
    } catch (e) {
      setChartError('Grafik hatası: ' + (e instanceof Error ? e.message : String(e)))
    } finally {
      setGeneratingCharts(false)
    }
  }

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
      const sources = [
        json?.google   > 0 ? `Google: ${json.google}`     : null,
        json?.unsplash > 0 ? `Unsplash: ${json.unsplash}` : null,
        json?.wikimedia > 0 ? `Wikimedia: ${json.wikimedia}` : null,
        json?.dalle    ? 'DALL-E: ✓' : null,
        json?.map      ? 'Harita: ✓' : null,
      ].filter(Boolean).join(', ')
      const queryUsed = json?.searchQuery ? ` · Arama: "${json.searchQuery}"` : ''
      setVisualNotice(`${count} görsel kaydedildi (${sources})${queryUsed}. Yenileniyor…`)
      // Wait a bit for DB replication, then re-fetch
      setTimeout(() => { load(); setVisualNotice(null) }, 2500)
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
          title="DALL-E illüstrasyonu, Wikimedia fotoğrafları ve coğrafi harita oluşturur"
        >
          {generatingVisuals ? '⏳ Görseller…' : '🎨 Görsel Oluştur'}
        </button>
        {agents.length > 0 ? (
          <select
            value={selectedAgentCode}
            onChange={e => setSelectedAgentCode(e.target.value)}
            className="report-toolbar-btn"
            style={{ cursor: 'pointer', paddingRight: 8 }}
            title="Özeti hangi ajan yazsın?"
          >
            <option value="">Ajan seç (varsayılan)</option>
            {agents.map(a => (
              <option key={a.id} value={a.code}>{a.name ?? a.code}</option>
            ))}
          </select>
        ) : null}
        <button
          className="report-toolbar-btn"
          onClick={generateSummary}
          disabled={generatingSummary || !job || job.status !== 'success'}
          style={{ borderColor: 'rgba(134,239,172,0.4)', color: 'rgba(134,239,172,0.9)' }}
          title="Seçili ajan tüm raporu okuyarak kapsamlı bir özet yazar"
        >
          {generatingSummary ? '⏳ Özet yazılıyor…' : '📋 Özet Oluştur'}
        </button>
        <button
          className="report-toolbar-btn"
          onClick={generateCharts}
          disabled={generatingCharts || !job || job.status !== 'success'}
          style={{ borderColor: 'rgba(96,165,250,0.4)', color: 'rgba(96,165,250,0.9)' }}
          title="Araştırma metnindeki verilerden Mermaid grafikleri üretir"
        >
          {generatingCharts ? '⏳ Grafikler…' : '📊 Grafik Oluştur'}
        </button>
        <button className="report-toolbar-btn" onClick={load}>↻ Yenile</button>
        <span className="report-toolbar-title">
          {job?.domain_pack ?? 'Rapor'} · {outputs.filter(o => o.output_type !== 'image' && o.output_type !== 'summary').length} bölüm
          {outputs.filter(o => o.output_type === 'image').length > 0
            ? ` · ${outputs.filter(o => o.output_type === 'image').length} görsel`
            : ''}
          {outputs.filter(o => o.output_type === 'summary').length > 0 ? ' · özet ✓' : ''}
        </span>
      </div>

      {visualNotice ? (
        <div style={{ padding: '10px 56px', background: '#1a1a2e', fontFamily: 'Arial', fontSize: 13, color: 'rgba(251,191,36,0.9)', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
          {visualNotice}
        </div>
      ) : null}
      {summaryNotice ? (
        <div style={{ padding: '10px 56px', background: '#1a1a2e', fontFamily: 'Arial', fontSize: 13, color: 'rgba(134,239,172,0.9)', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
          {summaryNotice}
        </div>
      ) : null}
      {chartNotice ? (
        <div style={{ padding: '10px 56px', background: '#1a1a2e', fontFamily: 'Arial', fontSize: 13, color: 'rgba(96,165,250,0.9)', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
          {chartNotice}
        </div>
      ) : null}
      {chartError ? (
        <div style={{ padding: '10px 56px', background: '#1a0a10', fontFamily: 'Arial', fontSize: 13, color: 'rgba(255,150,150,0.95)', borderBottom: '1px solid rgba(255,100,100,0.15)', display: 'flex', alignItems: 'center', gap: 12 }}>
          <span>⚠️ {chartError}</span>
          <button onClick={() => setChartError(null)} style={{ background: 'none', border: 'none', color: 'inherit', cursor: 'pointer', fontSize: 16, lineHeight: 1 }}>✕</button>
        </div>
      ) : null}
      {summaryError ? (
        <div style={{ padding: '10px 56px', background: '#2a1010', fontFamily: 'Arial', fontSize: 13, color: 'rgba(255,150,150,0.95)', borderBottom: '1px solid rgba(255,100,100,0.2)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span>⚠️ {summaryError}</span>
          <button onClick={() => setSummaryError(null)} style={{ background: 'none', border: 'none', color: 'rgba(255,150,150,0.7)', cursor: 'pointer', fontSize: 16 }}>✕</button>
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
            const imageOutputs   = outputs.filter(o => o.output_type === 'image')
            const summaryOutputs = outputs.filter(o => o.output_type === 'summary')
            const chartOutputs   = outputs.filter(o => o.output_type === 'charts')
            const textOutputs    = outputs.filter(o => o.output_type !== 'image' && o.output_type !== 'summary' && o.output_type !== 'charts')

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

                {/* No images yet — prompt */}
                {imageOutputs.length === 0 && textOutputs.length > 0 && job?.status === 'success' ? (
                  <div style={{
                    margin: '32px 0',
                    padding: '20px 24px',
                    borderRadius: 10,
                    border: '1.5px dashed #c8c0b8',
                    background: '#faf8f5',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 16,
                    fontFamily: 'Arial, sans-serif',
                  }}>
                    <div>
                      <div style={{ fontWeight: 700, fontSize: 14, color: '#1a1a2e', marginBottom: 4 }}>Görsel henüz oluşturulmadı</div>
                      <div style={{ fontSize: 13, color: '#888' }}>Üstteki <strong>🎨 Görsel Oluştur</strong> butonuna tıklayarak DALL-E illüstrasyonu, Wikimedia fotoğrafları ve coğrafi harita ekleyebilirsiniz.</div>
                    </div>
                  </div>
                ) : null}

                {/* Charts section */}
                {chartOutputs.length > 0 ? chartOutputs.map((o) => {
                  const body = outputBody(o)
                  return (
                    <div key={o.id} style={{ margin: '48px 0', borderRadius: 12, border: '2px solid #1e3a5f', background: 'linear-gradient(135deg, #f0f6ff 0%, #e8f0ff 100%)', overflow: 'hidden' }}>
                      <div style={{ background: 'linear-gradient(90deg, #0f2744 0%, #1e3a5f 100%)', padding: '16px 24px', display: 'flex', alignItems: 'center', gap: 12 }}>
                        <span style={{ fontSize: 20 }}>📊</span>
                        <div>
                          <div style={{ fontFamily: 'Arial', fontWeight: 700, fontSize: 15, color: 'white', letterSpacing: 0.3 }}>
                            Araştırma Grafikleri
                          </div>
                          <div style={{ fontFamily: 'Arial', fontSize: 11, color: 'rgba(150,200,255,0.8)', marginTop: 2 }}>
                            ChartAgent · Araştırma verilerinden otomatik üretildi
                          </div>
                        </div>
                      </div>
                      <div style={{ padding: '24px 28px' }}>
                        <ChartJsPanel output={o} />
                      </div>
                    </div>
                  )
                }) : (
                  // No charts yet — prompt only if job is done and there's content
                  textOutputs.length > 0 && job?.status === 'success' ? (
                    <div style={{ margin: '32px 0', padding: '16px 20px', border: '1px dashed rgba(96,165,250,0.3)', borderRadius: 10, display: 'flex', alignItems: 'center', gap: 16 }}>
                      <span style={{ fontSize: 28 }}>📊</span>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontFamily: 'Arial', fontSize: 13, fontWeight: 600, color: '#60a5fa', marginBottom: 4 }}>Grafik henüz oluşturulmadı</div>
                        <div style={{ fontFamily: 'Arial', fontSize: 12, color: '#888' }}>Yukarıdaki <strong>📊 Grafik Oluştur</strong> butonuna tıklayarak araştırma verilerini görselleştirin.</div>
                      </div>
                    </div>
                  ) : null
                )}

                {/* Summary section — shown at end before images */}
                {summaryOutputs.length > 0 ? summaryOutputs.map((o) => {
                  const body = outputBody(o)
                  return (
                    <div key={o.id} style={{
                      margin: '48px 0',
                      borderRadius: 12,
                      border: '2px solid #0f3460',
                      background: 'linear-gradient(135deg, #f8f7ff 0%, #f0f4ff 100%)',
                      overflow: 'hidden',
                    }}>
                      <div style={{
                        background: 'linear-gradient(90deg, #1a1a2e 0%, #0f3460 100%)',
                        padding: '16px 24px',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 12,
                      }}>
                        <span style={{ fontSize: 20 }}>📋</span>
                        <div>
                          <div style={{ color: '#fff', fontWeight: 700, fontSize: 16, fontFamily: 'Georgia, serif' }}>
                            Araştırma Özeti
                          </div>
                          <div style={{ color: 'rgba(255,255,255,0.6)', fontSize: 11, fontFamily: 'Arial', marginTop: 2 }}>
                            SummaryAgent · Tüm ajan çıktıları sentezlendi
                          </div>
                        </div>
                      </div>
                      <div style={{ padding: '24px 28px' }}>
                        {body ? <div>{renderMd(body)}</div> : null}
                      </div>
                    </div>
                  )
                }) : (job?.status === 'success' && textOutputs.length > 0 ? (
                  <div style={{
                    margin: '48px 0',
                    padding: '20px 24px',
                    borderRadius: 10,
                    border: '1.5px dashed #b0b8d0',
                    background: '#f8f7ff',
                    fontFamily: 'Arial, sans-serif',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 16,
                  }}>
                    <div>
                      <div style={{ fontWeight: 700, fontSize: 14, color: '#1a1a2e', marginBottom: 4 }}>Henüz özet yok</div>
                      <div style={{ fontSize: 13, color: '#666' }}>
                        <strong>📋 Özet Oluştur</strong> butonuna tıklayarak SummaryAgent tüm ajan çıktılarını okuyup kapsamlı bir özet yazar.
                      </div>
                    </div>
                  </div>
                ) : null)}

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
                        <MapImage key={o.id} img={img} />
                      )
                    })}

                    {/* DALL-E image */}
                    {imageOutputs.filter(o => (o.content_json as ImageContent | null)?.type === 'dalle').map(o => {
                      const img = o.content_json as ImageContent
                      return (
                        <FailsafeImage key={o.id} img={img} label="🤖 AI İllüstrasyon"
                          labelRight={<span style={{ fontSize: 11, color: '#e2814a' }}>{img.source}{img.expiring ? ' · URL geçici (1-2 saat)' : ''}</span>}
                        />
                      )
                    })}

                    {/* Google Images grid */}
                    {(() => {
                      const googleOutputs = imageOutputs.filter(o => (o.content_json as ImageContent | null)?.type === 'google')
                      if (googleOutputs.length === 0) return null
                      return (
                        <>
                          <div style={{ fontSize: 12, fontFamily: 'Arial', color: '#888', marginBottom: 10, marginTop: 16 }}>
                            🔍 Google Görselleri ({googleOutputs.length})
                          </div>
                          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 12, marginBottom: 16 }}>
                            {googleOutputs.map(o => {
                              const img = o.content_json as ImageContent
                              return <WikiCard key={o.id} img={img} />
                            })}
                          </div>
                        </>
                      )
                    })()}

                    {/* Unsplash grid */}
                    {(() => {
                      const unsplashOutputs = imageOutputs.filter(o => (o.content_json as ImageContent | null)?.type === 'unsplash')
                      if (unsplashOutputs.length === 0) return null
                      return (
                        <>
                          <div style={{ fontSize: 12, fontFamily: 'Arial', color: '#888', marginBottom: 10, marginTop: 16 }}>
                            📸 Unsplash Fotoğrafları ({unsplashOutputs.length})
                          </div>
                          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 12, marginBottom: 16 }}>
                            {unsplashOutputs.map(o => {
                              const img = o.content_json as ImageContent
                              return <WikiCard key={o.id} img={img} />
                            })}
                          </div>
                        </>
                      )
                    })()}

                    {/* Wikimedia grid */}
                    {(() => {
                      const wikiOutputs = imageOutputs.filter(o => (o.content_json as ImageContent | null)?.type === 'wikimedia')
                      if (wikiOutputs.length === 0) return null
                      return (
                        <>
                          <div style={{ fontSize: 12, fontFamily: 'Arial', color: '#888', marginBottom: 10, marginTop: 16 }}>
                            📷 Wikimedia Commons ({wikiOutputs.length})
                          </div>
                          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 12, marginBottom: 16 }}>
                            {wikiOutputs.map(o => {
                              const img = o.content_json as ImageContent
                              return (
                                <WikiCard key={o.id} img={img} />
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
