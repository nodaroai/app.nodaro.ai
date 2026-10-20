/**
 * What Render final runs for a clip set, as the footer names it (§4.2 of the
 * inspectors design, A4-2): "Render Clip ×6 → Caption Clip ×6" — each node of
 * the run with the times it runs. The set is the run's own (`renderFinalRunSet`
 * at the final's overrides: the render, what follows it and, in multicam,
 * Camera Switch before it), the times are the cost estimate's fan-out
 * (`getCostFactors`), so the sentence never disagrees with the price beside it.
 * In run order: a node after the nodes that feed it.
 *
 * A use-case node (Clip Pack) renders in its own hidden run: its Render final
 * is the continuation of that run (`usecaseRenderFinalTarget`, the override
 * the editor's Render final sends), and what it runs is the chain the estimate
 * expands it into (`expandUseCaseNodes`, the one the price beside the sentence
 * reads) — its render and what follows it, from the settings of the run that
 * made the Preview, at the times each runs over the kept clips — then every
 * canvas node after it (`usecaseFinalRunSet`), as the run and its price have them.
 */
import { isRenderNodeType, withRunOverrides } from "@nodaro/shared/nodes"
import { expandUseCaseNodes, isUseCaseNodeType, usecaseFinalRunSet, usecaseRenderFinalOverrides } from "@nodaro/render-rules"
import { renderFinalRunSet, renderRunOverrides } from "@/components/editor/workflow-editor/render-final-set"
import { runNodeLabel, usecaseEditorExpandOptions } from "@/components/editor/workflow-editor/estimate-run-credits"
import { previewRunnable } from "@/components/editor/workflow-editor/preview-gate"
import { liveExecutable } from "@/components/editor/workflow-editor/run-from-here-set"
import { getCostFactors } from "@/components/editor/workflow-editor/types"
import { usecaseRenderFinalTarget } from "@/lib/use-case-render-final-target"
import type { WorkflowEdge, WorkflowNode } from "@/types/nodes"
import { usecaseReviewable } from "./use-case-review-source"

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

/**
 * A use-case node's Render final, step by step: the inner nodes of its final
 * chain that run (the expansion's members of the node) and the canvas nodes
 * after it (their ids are kept by the expansion), each at the times the
 * estimate prices it. A use-case node after it runs as its own inner nodes on
 * the expanded graph, and its price is one line of its own: the chain names
 * it once, by its own label, at that line's times. Empty when the node has no
 * Render final now.
 */
function usecaseClipChain(nodeId: string, nodes: WorkflowNode[], edges: WorkflowEdge[]): ClipChainStep[] {
  // A node the review cannot open (a list drives it, no clip set yet) has none.
  const target = usecaseRenderFinalTarget(nodes.find((n) => n.id === nodeId))
  if (!target || !usecaseReviewable(nodeId, nodes, edges)) return []
  const outer = withRunOverrides(nodes, usecaseRenderFinalOverrides(nodeId, target))
  // As the estimate expands it for this viewer: a multicam pack's per-clip Camera Switch is a step of its final.
  const expansion = expandUseCaseNodes(outer, edges, usecaseEditorExpandOptions())
  const runSet = usecaseFinalRunSet(nodeId, nodes, edges)
  const runs = new Set([...(expansion.members.get(nodeId) ?? []), ...runSet])
  runs.delete(nodeId)
  // The inner nodes of each use-case node after it, by the node they stand for.
  const ownerOf = new Map<string, string>()
  for (const id of runSet) {
    if (id === nodeId || !isUseCaseNodeType(outer.find((n) => n.id === id)?.type)) continue
    for (const m of expansion.members.get(id) ?? []) {
      runs.add(m)
      ownerOf.set(m, id)
    }
  }
  const graph = expansion.nodes as WorkflowNode[]
  const wires = expansion.edges as WorkflowEdge[]
  // As the canvas render's: the stop rule's closure never runs (a final holds nothing).
  const steps = previewRunnable(liveExecutable(graph).filter((n) => runs.has(n.id)), graph, wires)
  const rerun = new Set(steps.map((n) => n.id))
  const outerRerun = new Set(liveExecutable(outer).filter((n) => runSet.has(n.id)).map((n) => n.id))
  const named = new Set<string>()
  return inRunOrder(steps, wires).flatMap((node): ClipChainStep[] => {
    const owner = ownerOf.get(node.id)
    if (owner === undefined) return [{ nodeId: node.id, label: runNodeLabel(node), times: getCostFactors(node, graph, wires, rerun).fanOut }]
    if (named.has(owner)) return []
    named.add(owner)
    const own = outer.find((n) => n.id === owner)!
    return [{ nodeId: owner, label: runNodeLabel(own), times: getCostFactors(own, outer, edges, outerRerun).fanOut }]
  })
}

export function clipRenderChain(renderId: string, nodes: WorkflowNode[], edges: WorkflowEdge[]): ClipChainStep[] {
  const type = nodes.find((n) => n.id === renderId)?.type
  if (isUseCaseNodeType(type)) return usecaseClipChain(renderId, nodes, edges)
  // `renderFinalRunSet` walks on from any node: only a render has a Render final.
  if (!isRenderNodeType(type)) return []
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
