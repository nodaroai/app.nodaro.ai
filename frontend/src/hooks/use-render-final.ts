/**
 * Render final and Update preview on a render node, as the node's bar and the
 * context menu use them. The prices are the runs' own estimates over their own
 * set, taken on the graph the run executes (the render with its quality
 * overridden), so a button never quotes less than the run bills: on the canvas
 * the render still reads Preview, which would gate the tail out of the final's
 * price.
 *
 * Mount it only where the buttons show — it recomputes on every graph change.
 */
import { useMemo } from "react"
import { withRunOverrides } from "@nodaro/shared"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { useRunSetCredits } from "@/hooks/use-run-from-here-credits"
import { liveExecutable } from "@/components/editor/workflow-editor/run-from-here-set"
import { renderFinalRunSet, renderRunOverrides } from "@/components/editor/workflow-editor/render-final-set"
import { runtimePreviewStopRule } from "@/lib/runtime-config"
import type { WorkflowEdge, WorkflowNode } from "@/types/nodes"

const NONE: WorkflowNode[] = []

/** The run of `renderId` at `kind`: its executable nodes, on the overridden graph. */
function runAs(renderId: string, kind: "final" | "proxy", nodes: WorkflowNode[], edges: WorkflowEdge[]) {
  const set = renderFinalRunSet(renderId, nodes, edges)
  if (!set.has(renderId)) return { executable: NONE, graph: nodes }
  const graph = withRunOverrides(nodes, renderRunOverrides(renderId, kind, set))
  return { executable: liveExecutable(graph).filter((n) => set.has(n.id)), graph }
}

export interface RenderFinalControls {
  readonly renderFinal: () => void
  readonly updatePreview: () => void
  /** Credits Render final will charge; 0 outside credit editions. */
  readonly finalCredits: number
  /** Credits Update preview will charge; 0 outside credit editions or with the flag off. */
  readonly previewCredits: number
  /** Update preview exists only with the stop rule on (decided 2026-10-06). */
  readonly canUpdatePreview: boolean
}

export function useRenderFinal(renderId: string): RenderFinalControls {
  const nodes = useWorkflowStore((s) => s.nodes)
  const edges = useWorkflowStore((s) => s.edges)
  const canUpdatePreview = runtimePreviewStopRule()
  const asFinal = useMemo(() => runAs(renderId, "final", nodes, edges), [renderId, nodes, edges])
  const asPreview = useMemo(
    () => (canUpdatePreview ? runAs(renderId, "proxy", nodes, edges) : { executable: NONE, graph: nodes }),
    [canUpdatePreview, renderId, nodes, edges],
  )
  const finalCredits = useRunSetCredits(asFinal.executable, asFinal.graph, edges)
  const previewCredits = useRunSetCredits(asPreview.executable, asPreview.graph, edges)
  return {
    renderFinal: () => useWorkflowStore.getState().renderFinal?.(renderId, "final"),
    updatePreview: () => useWorkflowStore.getState().renderFinal?.(renderId, "proxy"),
    finalCredits,
    previewCredits,
    canUpdatePreview,
  }
}
