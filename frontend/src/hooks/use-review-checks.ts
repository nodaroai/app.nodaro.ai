/**
 * What the review inspector judges about the edit as it stands (§2.1 of the
 * inspectors design, A3-2), all read with the NOT-YET-WRITTEN edit in place
 * (`withPendingReview`: a pure overlay of the canvas, no store write), so
 * nothing lags the debounced write. Recomputed REVIEW_CHECK_DEBOUNCE_MS after
 * its inputs settle: the pending edit, the canvas the render reads
 * (`useReviewGraph`: a run's progress and status ticks, and edits beside the
 * render, are not a change), and the model's take and plan status. The first
 * read is immediate.
 *
 *  - `verdict`: the footer gate, the anchored render's own rule
 *    (`renderRuleVerdict`, TA1 a). `handleRenderFinal` re-runs every check; the
 *    footer is a convenience, not the guard.
 *  - `fresh` (R1, R19): the take's `planBasis` and `renderBasis` against what
 *    the render would stamp now (staleness.ts). `staleTake` is the banner (R4 a).
 *  - `clockMap` (R3 a): the effective EDL on the render's wire, only for a fresh
 *    take. Behind Camera Switch it is null: a take records no run it shares
 *    with the switch's saved output, so the map cannot be shown to be the cut
 *    the take was made from, and clicks play the original instead.
 */
import { useEffect, useMemo, useState } from "react"
import type { Edl, RenderGraphEdge } from "@nodaro/shared"
import { useReviewGraph } from "@/hooks/use-review-graph"
import { applyEdlRenderSettings, resolveApplyEdlRenders } from "@/lib/apply-edl-render-input"
import { clockMapOf } from "@/lib/edl-review/review-clock"
import { isFreshTake, renderSettingsBasisOf, showsStaleTake } from "@/lib/edl-review/staleness"
import { withPendingReview } from "@/lib/edl-review/write-review"
import { currentRenderPlanBasis } from "@/components/editor/workflow-editor/apply-edl-stamps"
import { renderRuleVerdict, type RenderRuleVerdict } from "@/components/editor/workflow-editor/render-final-checks"
import type { ReviewEdits } from "./use-review-edits"
import type { ReviewModel } from "./use-review-model"

export const REVIEW_CHECK_DEBOUNCE_MS = 150

export interface ReviewChecks {
  /** The render rule's verdict on the edit; undefined with no render or plan. */
  readonly verdict: RenderRuleVerdict | undefined
  readonly fresh: boolean | undefined
  /** The stale-preview banner shows. */
  readonly staleTake: boolean
  readonly clockMap: Edl | null
}

/** `value`, held until it has stopped changing for `ms`; the first value at once. */
function useSettled<T>(value: T, ms: number): T {
  const [settled, setSettled] = useState(value)
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), ms)
    return () => clearTimeout(timer)
  }, [value, ms])
  return settled
}

export function useReviewChecks(model: ReviewModel, edits: ReviewEdits): ReviewChecks {
  const { renderId, planId, take, passesOtherNodes, render, editStatus, renderExists } = model
  const canvas = useReviewGraph(renderId)
  // The inspector owns the plan's edit only while it holds K; otherwise the
  // canvas is judged as it stands.
  const owned = edits.kept !== null
  const pending = edits.pendingReview
  const input = useMemo(
    () => ({ canvas, owned, pending, take, editStatus, render, passesOtherNodes, renderExists, planId }),
    [canvas, owned, pending, take, editStatus, render, passesOtherNodes, renderExists, planId],
  )
  const settled = useSettled(input, REVIEW_CHECK_DEBOUNCE_MS)

  return useMemo(() => {
    const { canvas, owned, pending, take, editStatus, render, passesOtherNodes, renderExists, planId } = settled
    if (!renderExists || !planId) return { verdict: undefined, fresh: undefined, staleTake: false, clockMap: null }
    const { nodes, edges } = canvas
    const graph = owned ? withPendingReview(nodes, planId, pending) : nodes
    const verdict = renderRuleVerdict(renderId, graph, edges)
    const renderNode = graph.find((n) => n.id === renderId)!
    const first = resolveApplyEdlRenders(renderNode, graph, edges)[0]
    const now = {
      planBasis: currentRenderPlanBasis(renderId, graph, edges as readonly RenderGraphEdge[], first?.row),
      renderBasis: renderSettingsBasisOf(first, applyEdlRenderSettings(renderNode.data as Record<string, unknown>)),
    }
    const fresh = isFreshTake(take, now)
    const planHasEdit = owned ? pending !== undefined : editStatus === "applied"
    return {
      verdict,
      fresh,
      staleTake: showsStaleTake(fresh, !!take, planHasEdit),
      clockMap: fresh === true && !passesOtherNodes ? clockMapOf(first?.edl, render) : null,
    }
  }, [settled, renderId])
}
