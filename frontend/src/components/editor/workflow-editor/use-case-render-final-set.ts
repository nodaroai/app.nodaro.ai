/**
 * What a Render final of a use-case node (Tighten Episode, decided 2026-10-13)
 * runs: a continuation of the run that made the TAKE ON SHOW — `useCaseContinue:
 * { mode: "render-final", jobId, settings }` on the node, an override of THIS
 * run only — and every node after it. One set for the run
 * (use-case-render-final.ts), for the price its buttons quote and for whether
 * they show (use-render-final.ts), so none of them can disagree. Each takes it
 * through the preview stop rule itself.
 *
 * It is offered only where the continue route takes it: the take on show is a
 * Preview its own run made (its result names that run's wrapper), and the node
 * is neither running nor failed (a failed node offers Continue instead — never
 * both). The continuation carries that run's settings (`useCaseSettings`, kept
 * on the take): a Render final renders with the PREVIEW's settings, whatever
 * the node says now (decided 2026-10-13), and its quote is built from them.
 *
 * A list-driven node runs once per item, each its own run: one continuation
 * on the node cannot name them, so it has no Render final (and no Continue).
 *
 * The run set (`usecaseFinalRunSet`) and the override's shape
 * (`usecaseRenderFinalOverrides`) are @nodaro/render-rules', shared with the
 * app runner's Render final, so the two cannot send different runs.
 */
import { withRunOverrides } from "@nodaro/shared/nodes"
import { usecaseFinalRunSet, usecaseRenderFinalOverrides } from "@nodaro/render-rules"
import { usecaseRenderFinalTarget } from "@/lib/use-case-render-final-target"
import type { WorkflowEdge, WorkflowNode } from "@/types/nodes"
import { getListFanOutForNode } from "./node-input-resolver"
import { liveExecutable } from "./run-from-here-set"

// Which run a Render final continues is decided below the UI (the review's footer reads it too).
export { usecaseRenderFinalOffered, usecaseRenderFinalTarget } from "@/lib/use-case-render-final-target"

type Overrides = Readonly<Record<string, Readonly<Record<string, unknown>>>>

export interface UseCaseRenderFinalRun {
  /** The node and every node after it. */
  readonly runSet: ReadonlySet<string>
  /** The continuation, on the node, for this run only. */
  readonly overrides: Overrides
  /** The graph the run executes: the overrides merged. */
  readonly graph: WorkflowNode[]
  /** The run set's live executable nodes on that graph (before the stop rule). */
  readonly executable: WorkflowNode[]
}

/** A use-case node fed by a list (one run per item): Continue and Render final cannot name one run. */
export function usecaseListDriven(node: WorkflowNode, nodes: WorkflowNode[], edges: WorkflowEdge[]): boolean {
  return getListFanOutForNode(node, nodes, edges) !== undefined
}

/** Render final of use-case node `nodeId`, as it would run now; null when it has none. */
export function usecaseRenderFinalRun(nodeId: string, nodes: WorkflowNode[], edges: WorkflowEdge[]): UseCaseRenderFinalRun | null {
  const node = nodes.find((n) => n.id === nodeId)
  const target = usecaseRenderFinalTarget(node)
  if (!node || !target || usecaseListDriven(node, nodes, edges)) return null
  const runSet = usecaseFinalRunSet(nodeId, nodes, edges)
  const overrides: Overrides = usecaseRenderFinalOverrides(nodeId, target)
  const graph = withRunOverrides(nodes, overrides)
  return { runSet, overrides, graph, executable: liveExecutable(graph).filter((n) => runSet.has(n.id)) }
}
