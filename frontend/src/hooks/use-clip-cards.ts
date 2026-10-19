/**
 * The Clip Pack inspector's cards (§4.1 of the inspectors design, A4-2): the
 * card model (`buildClipCards`) fed from the canvas, in two steps so the
 * inspector's run controls can sit between them.
 *
 *  - `useClipCardInputs`: everything the model reads that does not depend on a
 *    live run — the plan and its stored review, the reviewer's not-yet-written
 *    decisions, the render's data, the wires between them, and the settings
 *    basis each clip's render would stamp now (`clipRenderBasesBy`). Read through
 *    `useReviewGraph`, so a run's progress ticks and edits beside the render
 *    leave it alone. The renders are resolved with the decisions' KEEPS in place
 *    (a pure overlay, no store write): a hook edit changes neither a clip's
 *    render nor its basis (renderers never read `meta`, R2 a), so typing does
 *    not recompute them.
 *    A use-case node (Clip Pack) is read as the pair its run is
 *    (`reviewViewOf`): the render-side reads are its run's render's; the takes
 *    are the node's own (it holds its clips).
 *  - `useClipCards`: the cards, and `useLiveClipCards` the same cards while a
 *    run that includes the render is live (`clipLiveRun`): each kept clip whose
 *    take has not landed reads "rendering". The live render data is read from the
 *    store, the one place run state lives.
 */
import { useMemo } from "react"
import type { EditedClipDecision } from "@nodaro/shared/edl"
import type { RenderPlanHop } from "@nodaro/shared/nodes"
import { buildClipCards, type ClipCards, type ClipCardsInput, type ClipLiveRun } from "@/lib/edl-review/build-clip-cards"
import { clipLiveRun } from "@/lib/edl-review/clip-live"
import { clipRenderBasesBy } from "@/lib/edl-review/clip-render-bases"
import { clipReviewOf, withPendingReview } from "@/lib/edl-review/write-review"
import { renderRowsOf, renderSettingsBasisFor } from "@/lib/render-review-adapter"
import { planOutputOf } from "@/components/editor/workflow-editor/apply-edl-stamps"
import { reviewViewOf } from "@/lib/edl-review/use-case-review-source"
import { showsARunInFlight } from "./workflow-access-mode"
import { useReviewGraph } from "./use-review-graph"
import { ignoringEditOn, type ReviewModel } from "./use-review-model"
import { useWorkflowStore } from "./use-workflow-store"

const NO_HOPS: readonly RenderPlanHop[] = []

export function useClipCardInputs(model: ReviewModel, decisions: readonly EditedClipDecision[] | null): ClipCardsInput | null {
  const { renderId, planId, plan, editedEdl, path } = model
  // Held through the review's own writes: the plan's `editedEdl` is replaced by
  // the decisions' keeps below, so a hook write changes nothing this reads.
  const ignoreEdit = useMemo(() => ignoringEditOn(planId), [planId])
  const canvas = useReviewGraph(renderId, ignoreEdit)
  // What the render-side reads read (use-case-review-source.ts): the canvas as
  // it is for a render; for a use-case node the pair its run is.
  const view = useMemo(() => reviewViewOf(renderId, canvas.nodes, canvas.edges), [renderId, canvas])
  const keeps = decisions ? decisions.map((d) => (d.keep ? "1" : "0")).join("") : null

  // The render-side reads, with the keeps in place: not recomputed by a hook edit.
  const bases = useMemo(() => {
    if (!planId || keeps === null || !path) return undefined
    const keepsOnly = clipReviewOf(plan, [...keeps].map((k) => ({ keep: k === "1" })))
    const nodes = withPendingReview(view.nodes, planId, keepsOnly)
    const render = nodes.find((n) => n.id === view.renderId)
    const planNode = nodes.find((n) => n.id === planId)
    if (!render || !planNode) return undefined
    // The render's own rows and basis (render-review-adapter.ts).
    const renders = renderRowsOf(render, nodes, view.edges)
    return clipRenderBasesBy(renders, (row) => renderSettingsBasisFor(render, row), planOutputOf(planNode), path.hops)
  }, [view, planId, plan, path, keeps])

  // The takes: the anchored node's own data — a canvas render's, or the use-case node's (it holds its clips).
  const renderData = canvas.nodes.find((n) => n.id === renderId)?.data as Readonly<Record<string, unknown>> | undefined

  return useMemo(() => {
    if (!Array.isArray(plan) || !renderData) return null
    return {
      plan,
      editedEdl,
      ...(decisions ? { decisions } : {}),
      renderData,
      hops: path?.hops ?? NO_HOPS,
      ...(bases ? { renderBases: bases } : {}),
    }
  }, [plan, editedEdl, decisions, renderData, path, bases])
}

export function useClipCards(inputs: ClipCardsInput | null): ClipCards | null {
  return useMemo(() => (inputs ? buildClipCards(inputs) : null), [inputs])
}

/** The render's data while a run that includes it is live; undefined otherwise (so an idle inspector re-renders on no tick). */
function useLiveRenderData(renderId: string): Readonly<Record<string, unknown>> | undefined {
  return useWorkflowStore((s) => {
    const node = s.nodes.find((n) => n.id === renderId)
    return node && showsARunInFlight(node) ? (node.data as Readonly<Record<string, unknown>>) : undefined
  })
}

export function useLiveClipCards(
  renderId: string,
  inputs: ClipCardsInput | null,
  base: ClipCards | null,
  started: ClipLiveRun["quality"] | null,
): ClipCards | null {
  const liveData = useLiveRenderData(renderId)
  return useMemo(() => {
    if (!inputs || !base || !liveData) return base
    const live = clipLiveRun(liveData, { running: true, started, fallbackTotal: base.keptCount })
    return live ? buildClipCards({ ...inputs, renderData: liveData, live }) : base
  }, [inputs, base, liveData, started])
}

