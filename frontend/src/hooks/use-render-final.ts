/**
 * Render final and Update preview on a render node, as the node's bar and the
 * context menu use them. The prices are the runs' own estimates over their own
 * set, taken on the graph the run executes (the render with its quality
 * overridden), so a button never quotes less than the run bills: on the canvas
 * the render still reads Preview, which would gate the tail out of the final's
 * price.
 *
 * A use-case node (Tighten Episode) prices the continuation of its own run
 * that its Render final sends — its render at final and what follows, no fee —
 * and the nodes after it, on the graph carrying that continuation.
 *
 * Mount it only where the buttons show — it recomputes on every graph change.
 */
import { useMemo } from "react"
import { withRunOverrides } from "@nodaro/shared/nodes"
import { isUseCaseNodeType } from "@nodaro/render-rules"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { useRunSetPrice } from "@/hooks/use-run-from-here-credits"
import type { UgcPriceState } from "@/components/editor/workflow-editor/ugc-run-estimate"
import { liveExecutable } from "@/components/editor/workflow-editor/run-from-here-set"
import { renderFinalRunSet, renderRunOverrides } from "@/components/editor/workflow-editor/render-final-set"
import { usecaseRenderFinalRun } from "@/components/editor/workflow-editor/use-case-render-final-set"
import { runtimePreviewStopRule } from "@/lib/runtime-config"
import type { WorkflowEdge, WorkflowNode } from "@/types/nodes"

const NONE: WorkflowNode[] = []

/** The run of `renderId` at `kind`: its executable nodes, on the overridden graph. */
function runAs(renderId: string, kind: "final" | "proxy", nodes: WorkflowNode[], edges: WorkflowEdge[]) {
  if (isUseCaseNodeType(nodes.find((n) => n.id === renderId)?.type)) {
    // A use-case node's Render final continues its own run, no fee
    // (use-case-render-final.ts); it has no Update preview.
    const run = kind === "final" ? usecaseRenderFinalRun(renderId, nodes, edges) : null
    return run ? { executable: run.executable, graph: run.graph, available: true } : { executable: NONE, graph: nodes, available: false }
  }
  const set = renderFinalRunSet(renderId, nodes, edges)
  if (!set.has(renderId)) return { executable: NONE, graph: nodes, available: true }
  const graph = withRunOverrides(nodes, renderRunOverrides(renderId, kind, set))
  return { executable: liveExecutable(graph).filter((n) => set.has(n.id)), graph, available: true }
}

export interface RenderFinalControls {
  /** Settles once the editor's handler has started the run or given up on it. */
  readonly renderFinal: () => void | Promise<unknown>
  readonly updatePreview: () => void | Promise<unknown>
  /** Credits Render final will charge; 0 outside credit editions. */
  readonly finalCredits: number
  /** Credits Update preview will charge; 0 outside credit editions or with the flag off. */
  readonly previewCredits: number
  /** Render final's price is marked as an estimate: its UGC part's figure is not the server's checked one, and why. */
  readonly finalUnchecked?: UgcPriceState
  /** Update preview's, likewise. */
  readonly previewUnchecked?: UgcPriceState
  /** Update preview exists only with the stop rule on (decided 2026-10-06). */
  readonly canUpdatePreview: boolean
  /** Render final can go ahead here: always on a render; on a use-case node only
   *  while the take on show is a Preview its run can finish (use-case-render-final-set.ts). */
  readonly canRenderFinal: boolean
  /** A click on ANY render is waiting on its newer-run check (15 s at most,
   *  decided 2026-10-07): both run buttons are disabled. The editor holds one
   *  run click at a time (`handleRenderFinal`'s lock), so a click here would
   *  otherwise be dropped without a word. */
  readonly checkPending: boolean
  /** This render's run whose click is waiting on that check: that button
   *  alone shows it is busy (spinner, aria-busy). */
  readonly checking: "final" | "proxy" | null
}

export function useRenderFinal(renderId: string): RenderFinalControls {
  const nodes = useWorkflowStore((s) => s.nodes)
  const edges = useWorkflowStore((s) => s.edges)
  // A use-case node has no Update preview: its preview is its own run's.
  const useCase = isUseCaseNodeType(nodes.find((n) => n.id === renderId)?.type)
  const canUpdatePreview = runtimePreviewStopRule() && !useCase
  const checkPending = useWorkflowStore((s) => s.renderCheck != null)
  const checking = useWorkflowStore((s) => (s.renderCheck?.renderId === renderId ? s.renderCheck.kind : null))
  const asFinal = useMemo(() => runAs(renderId, "final", nodes, edges), [renderId, nodes, edges])
  const asPreview = useMemo(
    () => (canUpdatePreview ? runAs(renderId, "proxy", nodes, edges) : { executable: NONE, graph: nodes }),
    [canUpdatePreview, renderId, nodes, edges],
  )
  const finalPrice = useRunSetPrice(asFinal.executable, asFinal.graph, edges)
  const previewPrice = useRunSetPrice(asPreview.executable, asPreview.graph, edges)
  return {
    renderFinal: () => useWorkflowStore.getState().renderFinal?.(renderId, "final"),
    updatePreview: () => useWorkflowStore.getState().renderFinal?.(renderId, "proxy"),
    finalCredits: finalPrice.credits,
    previewCredits: previewPrice.credits,
    ...(finalPrice.unchecked ? { finalUnchecked: finalPrice.unchecked } : {}),
    ...(previewPrice.unchecked ? { previewUnchecked: previewPrice.unchecked } : {}),
    canUpdatePreview,
    canRenderFinal: asFinal.available,
    checkPending,
    checking,
  }
}
