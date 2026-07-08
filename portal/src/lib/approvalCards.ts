// PR-S6: Onay kuyruğu kart tipi — action_summary / action_detail'den türetilir.
// CLI RiskGate: action_summary = "tool:{slug}", action_detail = { tool, args }.

export type ApprovalCardKind = 'post_preview' | 'campaign_budget' | 'generic'

export type ToolApprovalParse = {
  tool: string | null
  args: Record<string, unknown> | null
}

export type ApprovalItemLike = {
  action_summary: string
  action_detail: Record<string, unknown> | null
}

export const POST_PREVIEW_TOOLS = new Set([
  'meta-social__post_publish',
  'social_reply_send',
])

export const BUDGET_TOOLS = new Set(['ads_campaign_activate'])

const TOOL_PREFIX = 'tool:'

export function stripToolPrefix(summary: string): string | null {
  const s = summary.trim()
  if (s.startsWith(TOOL_PREFIX)) return s.slice(TOOL_PREFIX.length).trim() || null
  return null
}

export function parseToolApproval(item: ApprovalItemLike): ToolApprovalParse {
  const detail = item.action_detail
  if (detail && typeof detail === 'object') {
    const tool = typeof detail.tool === 'string' ? detail.tool : null
    const args =
      detail.args && typeof detail.args === 'object' && !Array.isArray(detail.args)
        ? (detail.args as Record<string, unknown>)
        : null
    if (tool) return { tool, args }
  }

  const fromSummary = stripToolPrefix(item.action_summary)
  if (fromSummary) return { tool: fromSummary, args: null }

  return { tool: null, args: null }
}

export function resolveCardKind(toolSlug: string | null): ApprovalCardKind {
  if (!toolSlug) return 'generic'
  if (POST_PREVIEW_TOOLS.has(toolSlug)) return 'post_preview'
  if (BUDGET_TOOLS.has(toolSlug)) return 'campaign_budget'
  return 'generic'
}

export function strArg(args: Record<string, unknown> | null, key: string): string | null {
  if (!args) return null
  const v = args[key]
  return typeof v === 'string' && v.trim() ? v.trim() : null
}
