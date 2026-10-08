/**
 * What Render final runs for a clip set, as the footer names it (§4.2 of the
 * inspectors design, A4-2): "Render Clip ×6 → Caption Clip ×6" — each node of
 * the run with the times it runs. The set is the run's own (`renderFinalRunSet`
 * at the final's overrides: the render, what follows it and, in multicam,
 * Camera Switch before it), the times are the cost estimate's fan-out
 * (`getCostFactors`), so the sentence never disagrees with the price beside it.
 * In run order: a node after the nodes that feed it.
 */
import { isRenderNodeType, withRunOverrides } from "@nodaro/shared"
import { renderFinalRunSet, renderRunOverrides } from "@/components/editor/workflow-editor/render-final-set"
import { runNodeLabel } from "@/components/editor/workflow-editor/estimate-run-credits"
import { previewRunnable } from "@/components/editor/workflow-editor/preview-gate"
import { liveExecutable } from "@/components/editor/workflow-editor/run-from-here-set"
import { getCostFactors } from "@/components/editor/workflow-editor/types"
import type { WorkflowEdge, WorkflowNode } from "@/types/nodes"

export interface ClipChainStep {
  readonly nodeId: string
  /** The node's label as the canvas stores it (localized at render). */
  readonly label: string
  /** How many times the node runs in a Render final. */
  readonly times: number
}

/** `nodes` in run order: Kahn's walk over the edges between them, canvas order among equals. */
function inRunOrder(nodes: readonly WorkflowNode[], edges: readonly WorkflowEdge[]): WorkflowNode[] {
  const ids = new Set(nodes.map((n) => n.id))
  const waiting = new Map(nodes.map((n) => [n.id, 0]))
  for (const e of edges) if (ids.has(e.source) && ids.has(e.target) && e.source !== e.target) waiting.set(e.target, (waiting.get(e.target) ?? 0) + 1)
  const ordered: WorkflowNode[] = []
  const left = [...nodes]
  while (left.length > 0) {
    const at = left.findIndex((n) => (waiting.get(n.id) ?? 0) === 0)
    // A cycle cannot run; the rest follow in canvas order rather than loop.
    const [next] = left.splice(at === -1 ? 0 : at, 1)
    ordered.push(next!)
    for (const e of edges) if (e.source === next!.id && ids.has(e.target)) waiting.set(e.target, (waiting.get(e.target) ?? 1) - 1)
  }
  return ordered
}

export function clipRenderChain(renderId: string, nodes: WorkflowNode[], edges: WorkflowEdge[]): ClipChainStep[] {
  // `renderFinalRunSet` walks on from any node: only a render has a Render final.
  if (!isRenderNodeType(nodes.find((n) => n.id === renderId)?.type)) return []
  const set = renderFinalRunSet(renderId, nodes, edges)
  if (!set.has(renderId)) return []
  const graph = withRunOverrides(nodes, renderRunOverrides(renderId, "final", set))
  // The handler's own set: the stop rule's closure never runs (for a final, the render reads Final: nothing is gated).
  const executable = previewRunnable(liveExecutable(graph).filter((n) => set.has(n.id)), graph, edges)
  const rerun = new Set(executable.map((n) => n.id))
  return inRunOrder(executable, edges).map((node) => ({
    nodeId: node.id,
    label: runNodeLabel(node),
    times: getCostFactors(node, graph, edges, rerun).fanOut,
  }))
}
