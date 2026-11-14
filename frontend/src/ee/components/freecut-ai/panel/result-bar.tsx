/**
 * After an edit: how long the video is now, and the three things to do next —
 * play it, compare it with the original, or undo every change the agents made.
 */
import { Eye, Play, Undo2 } from "lucide-react"
import { formatNumber, useT } from "@/lib/i18n"

const seconds = (s: number) => formatNumber(s, { minimumFractionDigits: 1, maximumFractionDigits: 1 })

export interface ResultBarProps {
  readonly fromSeconds?: number
  readonly toSeconds?: number
  readonly busy: boolean
  readonly onPlay: () => void
  readonly onCompare: () => void
  readonly onUndoAll: () => void
}

export function ResultBar({ fromSeconds, toSeconds, busy, onPlay, onCompare, onUndoAll }: ResultBarProps) {
  const t = useT()
  const length =
    fromSeconds !== undefined && toSeconds !== undefined
      ? toSeconds < fromSeconds - 0.05
        ? t("freecutAi.summaryLength", { from: seconds(fromSeconds), to: seconds(toSeconds) })
        : t("freecutAi.lengthSame", { from: seconds(fromSeconds) })
      : null
  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-[#2D2D2D] px-4 py-2.5">
      {length ? <span className="me-auto font-mono text-xs text-white/75">{length}</span> : <span className="me-auto" />}
      <button type="button" onClick={onPlay} className="flex items-center gap-1.5 rounded-md bg-cta px-2.5 py-1.5 text-xs font-medium text-white hover:bg-cta-hover">
        <Play className="h-3.5 w-3.5" aria-hidden />
        {t("freecutAi.play")}
      </button>
      <button type="button" onClick={onCompare} className="flex items-center gap-1.5 rounded-md border border-white/15 px-2.5 py-1.5 text-xs text-white/85 hover:bg-white/10">
        <Eye className="h-3.5 w-3.5" aria-hidden />
        {t("freecutAi.compare")}
      </button>
      <button type="button" disabled={busy} onClick={onUndoAll} className="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs text-white/75 hover:bg-white/10 disabled:opacity-50">
        <Undo2 className="h-3.5 w-3.5" aria-hidden />
        {t("freecutAi.undoAll")}
      </button>
    </div>
  )
}
