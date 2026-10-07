"use client"

/**
 * One row of the review transcript (§2.3 of the inspectors design), memoised:
 * a cut re-renders only the rows whose marks, selection or find match changed.
 *
 *  - A PARAGRAPH: the source-time gutter (m:ss), the speaker, and its words as
 *    `<span data-w>` — struck in their reason's colour when cut, shaded when
 *    partly cut (▒). A reason chip sits at a dropped span's first word, and a
 *    ⟨⏸ 2.4 s⟩ chip marks a dropped pause that holds no word. Both open the
 *    span popover.
 *  - A COLLAPSED run (R11): one chip "[Tangent · 2:14 · 312 words ▸]" that
 *    expands in place, and ↺ to restore the whole run.
 * Words are `user-select: none`: the selection is the pane's own (selection.ts).
 */
import { memo, type ReactNode } from "react"
import { ChevronDown, ChevronRight, Pause, RotateCcw } from "lucide-react"
import type { EdlDropped } from "@nodaro/shared"
import { dropReasonLabel, dropReasonStyle } from "@/lib/edl-review/drop-reasons"
import type { CollapsedRow, ParagraphRow, ReviewRow } from "@/lib/edl-review/review-rows"
import type { WordGap, WordMark } from "@/lib/edl-review/word-index"
import { positionOf } from "@/lib/edl-review/review-time"
import { useT } from "@/lib/i18n"
import { useAppDir } from "@/lib/locale-store"
import { cn } from "@/lib/utils"
import type { TranscriptWords } from "./use-transcript-view"
import { useReviewFormat } from "./use-review-format"

export interface TranscriptRowProps {
  readonly row: ReviewRow
  readonly words: TranscriptWords
  readonly marks: readonly WordMark[]
  readonly dropped: readonly EdlDropped[]
  /** The selected words in this row's range (inclusive), or -1 when none. */
  readonly selFirst: number
  readonly selLast: number
  /** The current find match's words, or -1 when none. */
  readonly matchFirst: number
  readonly matchLast: number
  /** The row starts an expanded run: it carries the run's collapse control. */
  readonly runStart: boolean
  readonly canEdit: boolean
  readonly onOpenDrop: (drop: number, anchor: HTMLElement) => void
  readonly onExpand: (run: string) => void
  readonly onCollapse: (run: string) => void
  readonly onRestoreRun: (row: CollapsedRow) => void
}

function Gutter({ ms }: { readonly ms: number }) {
  return (
    <div dir="ltr" className="w-14 shrink-0 pt-0.5 text-end text-[11px] tabular-nums text-muted-foreground">
      {positionOf(ms)}
    </div>
  )
}

function GapChip({ gap, dropped, onOpenDrop }: { readonly gap: WordGap; readonly dropped: readonly EdlDropped[]; readonly onOpenDrop: TranscriptRowProps["onOpenDrop"] }) {
  const t = useT()
  const format = useReviewFormat()
  const d = dropped[gap.drop]
  if (!d) return null
  const length = format.length(d.outMs - d.inMs)
  return (
    <button
      type="button"
      data-drop={gap.drop}
      aria-label={t("edlReview.pause", { length })}
      className={cn("mx-0.5 inline-flex items-center gap-0.5 rounded px-1 align-middle text-[10px] leading-4", dropReasonStyle(d.reason).chip)}
      onClick={(e) => onOpenDrop(gap.drop, e.currentTarget)}
    >
      <Pause className="h-2.5 w-2.5" />
      <span dir="ltr">{length}</span>
    </button>
  )
}

function ReasonChip({ drop, reason, onOpenDrop }: { readonly drop: number; readonly reason: string; readonly onOpenDrop: TranscriptRowProps["onOpenDrop"] }) {
  const t = useT()
  return (
    <button
      type="button"
      data-drop={drop}
      className={cn("me-1 inline-flex items-center gap-0.5 rounded px-1 align-middle text-[10px] font-medium leading-4", dropReasonStyle(reason).chip)}
      onClick={(e) => onOpenDrop(drop, e.currentTarget)}
    >
      {dropReasonLabel(reason, t)}
      <RotateCcw className="h-2.5 w-2.5" />
    </button>
  )
}

function ParagraphBody(props: TranscriptRowProps & { readonly row: ParagraphRow }) {
  const { row, words, marks, dropped, selFirst, selLast, matchFirst, matchLast, runStart, onOpenDrop, onCollapse } = props
  const t = useT()
  const gapsBefore = new Map<number, WordGap[]>()
  for (const gap of row.gaps) {
    const at = Math.min(gap.beforeWord, row.end)
    gapsBefore.set(at, [...(gapsBefore.get(at) ?? []), gap])
  }
  const chips = (at: number) => (gapsBefore.get(at) ?? []).map((gap) => <GapChip key={`g${gap.drop}`} gap={gap} dropped={dropped} onOpenDrop={onOpenDrop} />)

  const pieces: ReactNode[] = []
  for (let i = row.first; i < row.end; i++) {
    pieces.push(...chips(i))
    const mark = marks[i] ?? { state: "kept" as const }
    const struck = mark.state !== "kept"
    if (struck && mark.drop !== undefined && mark.reason !== undefined && (i === row.first || marks[i - 1]?.drop !== mark.drop)) {
      pieces.push(<ReasonChip key={`r${i}`} drop={mark.drop} reason={mark.reason} onOpenDrop={onOpenDrop} />)
    }
    const style = struck && mark.reason !== undefined ? dropReasonStyle(mark.reason).strike : struck ? "line-through" : ""
    pieces.push(
      <span
        key={i}
        data-w={i}
        data-state={mark.state}
        className={cn(
          "rounded-sm",
          struck && "cursor-pointer text-muted-foreground",
          style,
          mark.state === "partial" && "bg-muted",
          i >= selFirst && i <= selLast && selFirst >= 0 && "bg-primary/25 text-foreground",
          i >= matchFirst && i <= matchLast && matchFirst >= 0 && "bg-amber-300/60 text-foreground dark:bg-amber-400/40",
        )}
      >
        {words[i]?.text}
      </span>,
      " ",
    )
  }
  pieces.push(...chips(row.end))

  return (
    <div className="min-w-0 flex-1">
      <div className="flex items-center gap-2">
        {row.speaker && <span className="text-[11px] font-medium text-muted-foreground">{row.speaker}</span>}
        {runStart && row.run && (
          <button
            type="button"
            aria-expanded
            data-run-toggle={row.run}
            className="inline-flex items-center gap-0.5 rounded px-1 text-[10px] text-muted-foreground hover:bg-muted"
            onClick={() => onCollapse(row.run!)}
          >
            <ChevronDown className="h-3 w-3" />
            {t("edlReview.collapseRun")}
          </button>
        )}
      </div>
      <p dir="auto" className="select-none text-sm leading-7">{pieces}</p>
    </div>
  )
}

function CollapsedBody({ row, canEdit, onExpand, onRestoreRun }: TranscriptRowProps & { readonly row: CollapsedRow }) {
  const t = useT()
  const format = useReviewFormat()
  const isRtl = useAppDir() === "rtl"
  const reason = row.reason ?? ""
  const words = row.words === 1 ? t("edlReview.wordsOne") : t("edlReview.wordsMany", { n: row.words })
  return (
    <div className="flex min-w-0 flex-1 items-center gap-1">
      <button
        type="button"
        aria-expanded={false}
        data-run-toggle={row.run}
        aria-label={t("edlReview.expandRun")}
        title={t("edlReview.expandRun")}
        className={cn("inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-medium", dropReasonStyle(reason).chip)}
        onClick={() => onExpand(row.run)}
      >
        {t("edlReview.collapsedRun", { reason: dropReasonLabel(reason, t), length: format.length(row.cutMs), words })}
        <ChevronRight className={cn("h-3 w-3", isRtl && "rotate-180")} />
      </button>
      {canEdit && (
        <button
          type="button"
          aria-label={t("edlReview.restore")}
          title={t("edlReview.restore")}
          className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
          onClick={() => onRestoreRun(row)}
        >
          <RotateCcw className="h-3 w-3" />
        </button>
      )}
    </div>
  )
}

function TranscriptRowComponent(props: TranscriptRowProps) {
  const { row } = props
  return (
    <div className="flex gap-3 px-3 py-1.5" data-row-kind={row.kind}>
      <Gutter ms={row.inMs} />
      {row.kind === "paragraph" ? <ParagraphBody {...props} row={row} /> : <CollapsedBody {...props} row={row} />}
    </div>
  )
}

export const TranscriptRow = memo(TranscriptRowComponent)
