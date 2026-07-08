import { useState } from 'react'
import { strArg } from '@/lib/approvalCards'

const PLATFORM_LABELS: Record<string, string> = {
  facebook:  'Facebook',
  instagram: 'Instagram',
  x:         'X',
}

type Props = {
  tool: string
  args: Record<string, unknown> | null
}

export function PostPreviewCard({ tool, args }: Props) {
  const [expanded, setExpanded] = useState(false)
  const platform = strArg(args, 'platform') ?? '—'
  const text = strArg(args, 'text') ?? ''
  const mediaUrl = strArg(args, 'media_url') ?? strArg(args, 'image_url')
  const itemId = strArg(args, 'item_id')
  const charCount = text.length
  const isReply = tool === 'social_reply_send'
  const preview = expanded || text.length <= 280 ? text : `${text.slice(0, 280)}…`

  return (
    <div className="rounded-xl border border-white/[0.08] bg-black/25 overflow-hidden">
      <div className="border-b border-white/[0.06] px-3 py-2 flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium text-white/50">
          {isReply ? 'Yanıt önizleme' : 'Post önizleme'}
        </span>
        <span className="rounded border border-blue-500/25 bg-blue-500/10 px-1.5 py-0.5 text-xs text-blue-300">
          {PLATFORM_LABELS[platform] ?? platform}
        </span>
        <span className="font-mono text-xs text-white/30">{tool}</span>
      </div>
      <div className="px-3 py-3 space-y-2">
        {isReply && itemId && (
          <div className="text-xs text-white/40">
            Yanıtlanan öğe: <span className="font-mono text-white/55">{itemId}</span>
          </div>
        )}
        {text ? (
          <p className="text-sm text-white/80 whitespace-pre-wrap break-words">{preview}</p>
        ) : (
          <p className="text-sm text-white/35 italic">Metin yok</p>
        )}
        {text.length > 280 && (
          <button
            type="button"
            className="text-xs text-blue-400 hover:text-blue-300"
            onClick={() => setExpanded((e) => !e)}
          >
            {expanded ? 'Daralt' : 'Tamamını göster'}
          </button>
        )}
        <div className="text-xs text-white/35">{charCount} karakter</div>
        {mediaUrl && (
          <div className="space-y-1">
            <a
              href={mediaUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-blue-400 underline underline-offset-2 break-all hover:text-blue-300"
            >
              {mediaUrl}
            </a>
            {mediaUrl.match(/\.(jpe?g|png|gif|webp)(\?|$)/i) && (
              <img
                src={mediaUrl}
                alt="Önizleme"
                className="max-h-40 rounded-lg border border-white/10 object-contain"
              />
            )}
          </div>
        )}
      </div>
    </div>
  )
}
