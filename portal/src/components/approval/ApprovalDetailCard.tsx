import { parseToolApproval, resolveCardKind } from '@/lib/approvalCards'
import { PostPreviewCard } from './PostPreviewCard'
import { CampaignBudgetCard } from './CampaignBudgetCard'
import { GenericKeyValueCard } from './GenericKeyValueCard'

export type ApprovalDetailItem = {
  action_summary: string
  action_detail: Record<string, unknown> | null
}

type Props = {
  item: ApprovalDetailItem
}

export function ApprovalDetailCard({ item }: Props) {
  const { tool, args } = parseToolApproval(item)
  const kind = resolveCardKind(tool)

  if (kind === 'post_preview' && tool) {
    return <PostPreviewCard tool={tool} args={args} />
  }
  if (kind === 'campaign_budget') {
    return <CampaignBudgetCard args={args} />
  }
  return <GenericKeyValueCard detail={item.action_detail} />
}
