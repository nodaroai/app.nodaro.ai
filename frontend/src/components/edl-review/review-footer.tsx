"use client"

/**
 * The review inspector's footer (§2.3 and §2.5 of the inspectors design):
 * ↶ ↷ (the review's undo, R8 a); the lengths, "Cut length {≤}{m:ss} · source
 * {m:ss} · removed {m:ss}" (review-stats.ts); Update preview (only with the
 * stop rule on) and Render final, each with its price, behind the gate
 * (review-gate.ts) and its reason: nothing kept, the rule's issues (listed
 * left-to-right on request), a newer run to load first. When the newer-run
 * check times out unanswered (15 s, decided 2026-10-07) the buttons enable
 * and a warning line says the check was not made. While a click's own check
 * (the same 15 s) is out, both buttons are disabled and the clicked one shows
 * it: a spinner, aria-busy (decided 2026-10-07). A check on another render
 * disables them too, without the spinner: the editor holds one run click at
 * a time. While a run includes
 * the render (R9 a) the buttons give way to its progress and "edits locked".
 *
 * Below `sm` (`compact`) the lengths shorten to "{cut} · −{removed}" and the
 * buttons stack.
 */
import { useDeferredValue, useMemo, useState } from "react"
import { Redo2, Undo2 } from "lucide-react"
import type { ReviewEdits } from "@/hooks/use-review-edits"
import type { ReviewModel } from "@/hooks/use-review-model"
import type { ReviewRuns } from "@/hooks/use-review-runs"
import { reviewLengths } from "@/lib/edl-review/review-stats"
import { positionOf } from "@/lib/edl-review/review-time"
import { useT } from "@/lib/i18n"
import { cn } from "@/lib/utils"
import { GateIssues, GateStatus, GateWarning } from "./review-gate-status"
import { ReviewRunButtons } from "./review-run-buttons"

export interface ReviewFooterProps {
  readonly model: ReviewModel
  readonly edits: ReviewEdits
  readonly runs: ReviewRuns
  readonly compact: boolean
}

const ICON = "rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-40"

export function ReviewFooter({ model, edits, runs, compact }: ReviewFooterProps) {
  const t = useT()
  const { base, render } = model
  // Deferred: a keystroke's commit strikes the words, and the lengths follow
  // in the next (§2.4's cut budget).
  const kept = useDeferredValue(edits.kept)
  const edited = useDeferredValue(edits.edited)
  const lengths = useMemo(() => (base && edited && kept ? reviewLengths(base, edited, kept, render) : null), [base, edited, kept, render])
  const [showIssues, setShowIssues] = useState(false)
  const { gate } = runs
  if (gate.mode === "hidden") return null

  const cut = lengths ? positionOf(lengths.outputMs) : ""
  const cutText = lengths?.approximate ? t("edlReview.atMost", { length: cut }) : cut
  const lengthText = !lengths ? "" : compact
    ? t("edlReview.lengthsShort", { cut: cutText, removed: positionOf(lengths.removedMs) })
    : t("edlReview.lengths", { cut: cutText, source: positionOf(lengths.sourceMs), removed: positionOf(lengths.removedMs) })

  return (
    <div data-testid="review-footer" className="flex flex-col gap-2">
      <div className={cn("flex gap-3", compact ? "flex-col" : "items-center")}>
        <div className="flex min-w-0 items-center gap-2">
          <button type="button" className={ICON} aria-label={t("edlReview.undo")} title={t("edlReview.undo")} disabled={!edits.canUndo} onClick={edits.undo}>
            <Undo2 className="h-4 w-4" />
          </button>
          <button type="button" className={ICON} aria-label={t("edlReview.redo")} title={t("edlReview.redo")} disabled={!edits.canRedo} onClick={edits.redo}>
            <Redo2 className="h-4 w-4" />
          </button>
          <span className="truncate text-xs tabular-nums text-muted-foreground">{lengthText}</span>
        </div>
        <div className={cn("flex gap-2", compact ? "flex-col" : "ms-auto items-center")}>
          <GateStatus gate={gate} runs={runs} showIssues={showIssues} onToggleIssues={() => setShowIssues((v) => !v)} />
          <ReviewRunButtons runs={runs} />
        </div>
      </div>
      <GateWarning gate={gate} />
      <GateIssues gate={gate} open={showIssues} />
    </div>
  )
}
