"use client"

/**
 * A row of the Cuts-only transcript (R5 a, decided 2026-10-06): with no
 * transcript on the plan's wire, the review lists the edit's kept segments and
 * dropped spans by time ("12:04 → 12:06  ● Filler"). A dropped span opens the
 * span popover, as a struck word does.
 */
import { memo } from "react"
import { RotateCcw } from "lucide-react"
import { dropReasonLabel, dropReasonStyle } from "@/lib/edl-review/drop-reasons"
import type { CutsOnlyRow as CutsOnlyRowData } from "@/lib/edl-review/review-rows"
import { positionOf } from "@/lib/edl-review/review-time"
import { useT } from "@/lib/i18n"
import { cn } from "@/lib/utils"

export interface CutsOnlyRowProps {
  readonly row: CutsOnlyRowData
  readonly onOpenDrop: (drop: number, anchor: HTMLElement) => void
}

function CutsOnlyRowComponent({ row, onOpenDrop }: CutsOnlyRowProps) {
  const t = useT()
  return (
    <div className="flex items-center gap-3 px-3 py-1.5 text-sm" data-row-kind={`cuts-${row.kind}`}>
      <span dir="ltr" className="w-32 shrink-0 text-xs tabular-nums text-muted-foreground">
        {positionOf(row.inMs)} → {positionOf(row.outMs)}
      </span>
      {row.kind === "kept" ? (
        <span className="text-xs text-muted-foreground">{t("edlReview.kept")}</span>
      ) : (
        <button
          type="button"
          data-drop={row.drop}
          className={cn("inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-medium", dropReasonStyle(row.reason).chip)}
          onClick={(e) => onOpenDrop(row.drop, e.currentTarget)}
        >
          <span className={cn("h-2 w-2 rounded-full", dropReasonStyle(row.reason).swatch)} />
          {dropReasonLabel(row.reason, t)}
          <RotateCcw className="h-3 w-3" />
        </button>
      )}
    </div>
  )
}

export const CutsOnlyRow = memo(CutsOnlyRowComponent)
