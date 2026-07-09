/**
 * D3a — plan_step step_spec sanitizasyonu ve untrusted taint → R3 yükseltme.
 */

export type PlanStepSpec = {
  topic:         string
  tools_spec:    string
  risk:          'R0' | 'R1' | 'R2' | 'R3'
  agent_slug?:   string
  deliverables?: string
}

export type ToolMeta = {
  slug:        string
  side_effect: string
  min_risk:    string
  compensation?: string | null
}

const RISK_RANK: Record<string, number> = { R0: 0, R1: 1, R2: 2, R3: 3 }

function riskRank(r: string): number {
  return RISK_RANK[r.trim().toUpperCase()] ?? 1
}

function maxRisk(a: string, b: string): 'R0' | 'R1' | 'R2' | 'R3' {
  return riskRank(a) >= riskRank(b) ? a.trim().toUpperCase() as PlanStepSpec['risk'] : b.trim().toUpperCase() as PlanStepSpec['risk']
}

/** tools_spec içinden slug listesi çıkarır: "tools: a, b; max_calls: 30" */
export function parseToolSlugsFromSpec(toolsSpec: string): string[] {
  const m = toolsSpec.match(/tools:\s*([^;]+)/i)
  if (!m) return []
  return m[1]
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s && s !== '_none')
}

function hasSideEffect(meta: ToolMeta): boolean {
  const se = (meta.side_effect ?? 'none').toLowerCase()
  return se === 'write' || se === 'external'
}

/**
 * Untrusted taint altında yan etkili araçlar için step risk'i min R3'e yükseltilir.
 * Canary floor ile max alınması operationLoopTick'te ayrıca yapılır.
 */
export function sanitizePlanStepSpec(
  spec: PlanStepSpec,
  untrustedTaint: boolean,
  toolMeta: Map<string, ToolMeta>,
  playbookDefaultRisk = 'R1',
): PlanStepSpec {
  let risk = maxRisk(spec.risk, playbookDefaultRisk)

  if (untrustedTaint) {
    const slugs = parseToolSlugsFromSpec(spec.tools_spec)
    for (const slug of slugs) {
      const meta = toolMeta.get(slug)
      if (meta && hasSideEffect(meta)) {
        risk = maxRisk(risk, 'R3')
        break
      }
    }
  }

  return {
    ...spec,
    topic:      spec.topic.slice(0, 500),
    tools_spec: spec.tools_spec.slice(0, 400),
    risk,
    agent_slug: spec.agent_slug?.slice(0, 64),
    deliverables: spec.deliverables?.slice(0, 300),
  }
}
