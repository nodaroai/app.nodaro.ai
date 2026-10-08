/**
 * The review inspector's runs (§2.3 and §2.5 of the inspectors design, A3-3b):
 * Render final and Update preview for the anchored render (`useRenderFinal`,
 * the same runs and prices as the render's bar), behind the footer's gate
 * (review-gate.ts).
 *
 *  - Each run writes the pending edit first (`flush`), so a cut made just
 *    before the click is in the plan the run reads (§2.2).
 *  - While a live run includes the render or its plan, edits are locked
 *    (R9 a): `running` names the run this inspector started (a final or a
 *    preview), and `progress` is the render's own job progress, read live.
 *    A run started elsewhere is named neutrally.
 *
 * The prices are `useRenderFinal`'s: they read the plan as written, so they
 * follow an edit once its debounced write lands. The gate reads the pending
 * edit (`useReviewChecks`), so it never lags. A render that cannot run at all
 * (`renderRunRefusalKey`: Speaker View until it is priced, C4) quotes no price:
 * both are 0, so no button, banner or footer that shows these figures quotes
 * the run-set estimate's fallback for a run that is refused.
 */
import { useCallback, useEffect, useMemo, useState } from "react"
import { useRenderFinal } from "@/hooks/use-render-final"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { reviewGate, type ReviewGate } from "@/lib/edl-review/review-gate"
import { renderRunRefusalKey } from "@/lib/render-review-adapter"
import type { ReviewChecks } from "./use-review-checks"
import type { ReviewEditState } from "./review-edit-state"
import type { ReviewModel } from "./use-review-model"

export type ReviewRunKind = "final" | "proxy"

export interface ReviewRuns {
  readonly gate: ReviewGate
  /** Credits Render final will charge; 0 outside credit editions and while the render's runs are refused. */
  readonly finalCredits: number
  /** Credits Update preview will charge; 0 likewise. */
  readonly previewCredits: number
  readonly canUpdatePreview: boolean
  /** While running: the run this inspector started, or null for one started elsewhere. */
  readonly running: ReviewRunKind | null
  /** The render's job progress (0–100) while it runs, when it reports one. */
  readonly progress: number | null
  /** A click on any render is waiting on its newer-run check (decided
   *  2026-10-07): both run buttons are disabled (`useRenderFinal`). */
  readonly checkPending: boolean
  /** This render's run whose click is waiting on that check: it alone shows
   *  it is busy. */
  readonly checking: ReviewRunKind | null
  readonly renderFinal: () => void
  readonly updatePreview: () => void
}

export function useReviewRuns(model: ReviewModel, edits: ReviewEditState, checks: ReviewChecks): ReviewRuns {
  const { renderId, locked } = model
  const controls = useRenderFinal(renderId)
  const readOnly = useWorkflowStore((s) => s.isReadOnly)
  // A render that cannot run at all holds both runs, and the footer says why.
  const refusal = useWorkflowStore((s) => renderRunRefusalKey(s.nodes.find((n) => n.id === renderId)))
  const progress = useWorkflowStore((s) => {
    const value = (s.nodes.find((n) => n.id === renderId)?.data as { currentJobProgress?: unknown } | undefined)?.currentJobProgress
    return typeof value === "number" && value > 0 ? Math.round(value) : null
  })

  // The run this inspector started; forgotten whenever no run holds the
  // review — once the run has come and gone, and as soon as the click's
  // handler settles without one (a cancelled confirm, a refusal). The handler
  // marks the render before it settles on a run it starts, so `locked` is
  // already true then; a click that started nothing must not name the next
  // run, started elsewhere, as this one.
  const [started, setStarted] = useState<ReviewRunKind | null>(null)
  const [settled, setSettled] = useState(0)
  useEffect(() => {
    if (!locked) setStarted(null)
  }, [locked, settled])

  const gate = useMemo(
    () => reviewGate({
      // A Tighten plan reviews when its segments are monotonic; a clip set always does.
      reviewable: !!model.planId && (model.planKind === "clips" || (!!model.base && model.reviewable)),
      readOnly,
      locked,
      keptCount: edits.keptCount,
      verdict: checks.verdict,
      ...(refusal ? { refusal } : {}),
      newerRun: model.newerRun,
      newerCheckTimedOut: model.newerRunCheckTimedOut,
    }),
    [model.base, model.reviewable, model.planKind, model.planId, readOnly, locked, edits.keptCount, checks.verdict, refusal, model.newerRun, model.newerRunCheckTimedOut],
  )

  const { flush } = edits
  const { renderFinal: runFinal, updatePreview: runPreview, canUpdatePreview } = controls
  const run = useCallback((kind: ReviewRunKind) => {
    if (gate.mode !== "ready" || gate.hold) return
    if (kind === "proxy" && !canUpdatePreview) return
    flush()
    setStarted(kind)
    const handled = kind === "final" ? runFinal() : runPreview()
    void Promise.resolve(handled).catch(() => undefined).finally(() => setSettled((n) => n + 1))
  }, [gate, canUpdatePreview, flush, runFinal, runPreview])

  return {
    gate,
    // A refused run charges nothing: no figure to quote (the gate says why).
    finalCredits: refusal ? 0 : controls.finalCredits,
    previewCredits: refusal ? 0 : controls.previewCredits,
    canUpdatePreview,
    running: gate.mode === "running" ? started : null,
    progress: gate.mode === "running" ? progress : null,
    checkPending: controls.checkPending,
    checking: controls.checking,
    renderFinal: useCallback(() => run("final"), [run]),
    updatePreview: useCallback(() => run("proxy"), [run]),
  }
}
