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
 *  - `renders`: every render the node's Run would make with the edit in place,
 *    and `validity`, what the header's badge shows: the anchored render's own
 *    rule on them (`render-review-adapter.ts`; Speaker View's, not Apply EDL's).
 *  - `clockMap` (R3 a), only for a fresh take, by the registry's `clockMapFrom`
 *    (`takeClockMap`): Apply EDL's is the effective EDL on its wire, null
 *    behind Camera Switch (a take records no run it shares with the switch's
 *    saved output, so clicks play the original instead); Speaker View's is the
 *    EDL the take itself emitted. `previewClockMap` is the same map for the
 *    newest Preview the player offers beside a Final on display (A3-4), judged
 *    by that take's own stamps.
 */
import { useEffect, useMemo, useState } from "react"
import type { Edl, RenderGraphEdge } from "@nodaro/shared"
import { useReviewGraph } from "@/hooks/use-review-graph"
import type { EdlValidity } from "@/lib/edl-validity"
import { renderReviewAdapterOf, takeClockMap, type RenderRow } from "@/lib/render-review-adapter"
import { isFreshTake, showsStaleTake } from "@/lib/edl-review/staleness"
import { withPendingReview } from "@/lib/edl-review/write-review"
import { currentRenderPlanBasis } from "@/components/editor/workflow-editor/apply-edl-stamps"
import { renderRuleVerdict, type RenderRuleVerdict } from "@/components/editor/workflow-editor/render-final-checks"
import type { ReviewEditState } from "./review-edit-state"
import type { ReviewModel } from "./use-review-model"

export const REVIEW_CHECK_DEBOUNCE_MS = 150

export interface ReviewChecks {
  /** The render rule's verdict on the edit; undefined with no render or plan. */
  readonly verdict: RenderRuleVerdict | undefined
  readonly fresh: boolean | undefined
  /** The stale-preview banner shows. */
  readonly staleTake: boolean
  readonly clockMap: Edl | null
  /** The clock map for the newest Preview beside the take on display (`model.previewTake`). */
  readonly previewClockMap: Edl | null
  /** Every render the Run would make with the edit in place; empty with no render or plan. */
  readonly renders: readonly RenderRow[]
  /** The anchored render's own rule on `renders` (the header's badge); null with nothing to judge. */
  readonly validity: EdlValidity | null
}

const NO_RENDERS: readonly RenderRow[] = []

/** `value`, held until it has stopped changing for `ms`; the first value at once. */
function useSettled<T>(value: T, ms: number): T {
  const [settled, setSettled] = useState(value)
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), ms)
    return () => clearTimeout(timer)
  }, [value, ms])
  return settled
}

export function useReviewChecks(model: ReviewModel, edits: ReviewEditState): ReviewChecks {
  const { renderId, planId, take, previewTake, passesOtherNodes, render, editStatus, renderExists } = model
  const canvas = useReviewGraph(renderId)
  // The inspector owns the plan's edit only while it holds K; otherwise the
  // canvas is judged as it stands.
  const owned = edits.keptCount !== null
  const pending = edits.pendingReview
  const input = useMemo(
    () => ({ canvas, owned, pending, take, previewTake, editStatus, render, passesOtherNodes, renderExists, planId }),
    [canvas, owned, pending, take, previewTake, editStatus, render, passesOtherNodes, renderExists, planId],
  )
  const settled = useSettled(input, REVIEW_CHECK_DEBOUNCE_MS)

  return useMemo(() => {
    const { canvas, owned, pending, take, previewTake, editStatus, render, passesOtherNodes, renderExists, planId } = settled
    if (!renderExists || !planId) {
      return { verdict: undefined, fresh: undefined, staleTake: false, clockMap: null, previewClockMap: null, renders: NO_RENDERS, validity: null }
    }
    const { nodes, edges } = canvas
    const graph = owned ? withPendingReview(nodes, planId, pending) : nodes
    const verdict = renderRuleVerdict(renderId, graph, edges)
    const renderNode = graph.find((n) => n.id === renderId)!
    const renderData = renderNode.data as Record<string, unknown>
    const adapter = renderReviewAdapterOf(renderNode.type)
    const renders = adapter ? adapter.rows(renderNode, graph, edges) : NO_RENDERS
    const first = renders[0]
    const now = {
      planBasis: currentRenderPlanBasis(renderId, graph, edges as readonly RenderGraphEdge[], first?.row),
      renderBasis: adapter?.settingsBasis(first, renderData),
    }
    const fresh = isFreshTake(take, now)
    const previewFresh = isFreshTake(previewTake, now)
    const planHasEdit = owned ? pending !== undefined : editStatus === "applied"
    const clockOf = (shown: typeof take) =>
      takeClockMap({ type: renderNode.type, renderData, take: shown, row: first, context: render, passesOtherNodes })
    return {
      verdict,
      fresh,
      staleTake: showsStaleTake(fresh, !!take, planHasEdit),
      clockMap: fresh === true ? clockOf(take) : null,
      previewClockMap: previewFresh === true ? clockOf(previewTake) : null,
      renders,
      validity: adapter ? adapter.validity(renders, renderData) : null,
    }
  }, [settled, renderId])
}
