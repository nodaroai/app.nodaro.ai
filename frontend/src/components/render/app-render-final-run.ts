/**
 * What an app run's Render final on one output card runs, for the price the
 * card quotes: the nodes the run executes and the graph it executes them on
 * (its overrides merged). The server computes the same run for the route
 * (`routes/app-render-final.ts`), from the same @nodaro/render-rules rules,
 * so the card quotes what the final runs.
 *
 *  - a render: its Render final set (`renderFinalRunSet`), the render at Final;
 *  - a use-case node (Tighten Episode, decided 2026-10-13): the node and every
 *    node after it (`usecaseFinalRunSet`), the node continuing the run that
 *    made its Preview (`usecaseRenderFinalOverrides`, built from the take ON
 *    SHOW in the run: its wrapper and the settings that run was built from,
 *    `usecasePreviewTarget`), with the run's review of its plan beside it. The
 *    shared expansion prices that as the node's final chain — its render at
 *    Final and what follows, with no fee — and on the PREVIEW's settings, never
 *    the creator's snapshot. A node fed by a list runs once per item and has
 *    no Render final.
 *
 * Nothing to run: an empty executable (the card offers no priced final).
 */
import { withRunOverrides } from "@nodaro/shared/nodes"
import {
  isUseCaseNodeType,
  renderFinalRunSet,
  usecaseFinalRunSet,
  usecasePreviewTarget,
  usecaseRenderFinalOverrides,
} from "@nodaro/render-rules"
import { liveExecutable } from "@/components/editor/workflow-editor/run-from-here-set"
import { usecaseListDriven } from "@/components/editor/workflow-editor/use-case-render-final-set"
import type { WorkflowEdge, WorkflowNode } from "@/types/nodes"

export interface AppRenderFinalRun {
  /** The nodes the final executes, on `nodes`. */
  readonly executable: WorkflowNode[]
  /** The graph it executes: the run on show's graph with the final's overrides merged. */
  readonly nodes: WorkflowNode[]
}

type States = Readonly<Record<string, unknown>>

/**
 * The run a use-case node's Render final continues in the run on show, or
 * null when its card offers none: its take there is not ONE Preview its run
 * names, or the node runs once per item of a list.
 */
export function appUseCaseFinalTarget(nodeId: string, nodes: readonly WorkflowNode[], edges: readonly WorkflowEdge[], states: States) {
  const node = nodes.find((n) => n.id === nodeId)
  if (!node || !isUseCaseNodeType(node.type) || usecaseListDriven(node, nodes as WorkflowNode[], edges as WorkflowEdge[])) return null
  return usecasePreviewTarget(states[nodeId], node.type)
}

export function appRenderFinalRun(
  renderId: string,
  graph: readonly WorkflowNode[],
  edges: readonly WorkflowEdge[],
  states: States,
): AppRenderFinalRun {
  const nodes = graph as WorkflowNode[]
  const node = graph.find((n) => n.id === renderId)
  if (isUseCaseNodeType(node?.type)) {
    const target = appUseCaseFinalTarget(renderId, graph, edges, states)
    if (!target) return { executable: [], nodes }
    // The run's review of the node's plan rides on the node, as the route sends it.
    const edit = (states[renderId] as { editedEdl?: unknown } | undefined)?.editedEdl
    const overridden = withRunOverrides(nodes, usecaseRenderFinalOverrides(renderId, target, edit != null ? { editedEdl: edit } : undefined))
    const set = usecaseFinalRunSet(renderId, graph, edges)
    return { executable: liveExecutable(overridden).filter((n) => set.has(n.id)), nodes: overridden }
  }
  const set = renderFinalRunSet(renderId, graph, edges)
  if (!set.has(renderId)) return { executable: [], nodes }
  const overridden = withRunOverrides(nodes, { [renderId]: { quality: "final" } })
  return { executable: liveExecutable(overridden).filter((n) => set.has(n.id)), nodes: overridden }
}
