"use client"

/**
 * The selection toolbar (M4 of the inspectors design; R10 a): it floats over a
 * finished drag or shift-click selection.
 *  - ✂ Cut selection · {the kept time it removes}: the whole words it touches
 *    (`cutRange`, word-snapped). Del does the same.
 *  - ↺ Restore selection · {the cut time it brings back}: shown when the
 *    selection touches a struck word; it snaps to whole words and goes through
 *    the restore lock (`restoreSpan`). R does the same.
 *  - ✕ clears the selection (so does Escape, before the find bar).
 * Not shown while edits are locked (R9 a): the selection then only copies (⌘C).
 */
import type { CSSProperties } from "react"
import { RotateCcw, Scissors, X } from "lucide-react"
import { useT } from "@/lib/i18n"
import { cn } from "@/lib/utils"
import { useReviewFormat } from "./use-review-format"

export interface SelectionToolbarProps {
  /** The selection's kept time, in ms: what Cut selection removes. */
  readonly cutMs: number
  /** The selection's cut time, in ms; shown only when it touches a struck word. */
  readonly restoreMs: number
  readonly touchesCut: boolean
  readonly onCut: () => void
  readonly onRestore: () => void
  readonly onClear: () => void
  readonly className?: string
  readonly style?: CSSProperties
}

const BUTTON = "inline-flex items-center gap-1 rounded px-2 py-1 text-xs hover:bg-muted"

export function SelectionToolbar({ cutMs, restoreMs, touchesCut, onCut, onRestore, onClear, className, style }: SelectionToolbarProps) {
  const t = useT()
  const format = useReviewFormat()
  return (
    <div
      role="toolbar"
      aria-label={t("edlReview.selection")}
      // A press here must not start a new selection in the words under it.
      onPointerDown={(e) => e.stopPropagation()}
      style={style}
      className={cn("flex w-fit items-center gap-0.5 rounded-md border border-border bg-popover p-0.5 shadow-md", className)}
    >
      {cutMs > 0 && (
        <button type="button" className={BUTTON} onClick={onCut}>
          <Scissors className="h-3 w-3" />
          {t("edlReview.cutSelection", { length: format.length(cutMs) })}
        </button>
      )}
      {touchesCut && (
        <button type="button" className={BUTTON} onClick={onRestore}>
          <RotateCcw className="h-3 w-3" />
          {t("edlReview.restoreSelection", { length: format.length(restoreMs) })}
        </button>
      )}
      <button type="button" aria-label={t("edlReview.clearSelection")} title={t("edlReview.clearSelection")} className={cn(BUTTON, "px-1.5")} onClick={onClear}>
        <X className="h-3 w-3" />
      </button>
    </div>
  )
}
