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
import { isUseCaseNodeType, usecaseFinalRunSet, usecaseRenderFinalOverrides, type UseCaseRenderFinalTarget } from "@nodaro/render-rules"
import { usecaseRunSettings, usecaseTakeOnShow } from "@/lib/use-case-run-result"
import { isValidUuid } from "@/lib/uuid"
import type { WorkflowEdge, WorkflowNode } from "@/types/nodes"
import { getListFanOutForNode } from "./node-input-resolver"
import { liveExecutable } from "./run-from-here-set"

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

/** A node status in which a run of the node is under way: Render final waits for it. */
const BUSY: ReadonlySet<string> = new Set(["running", "pending", "stopping"])

/** The Preview on show's own run (a real wrapper job, never a synthetic `exec-…` id) and its settings. */
function previewTakeRun(node: Pick<WorkflowNode, "type" | "data"> | undefined): UseCaseRenderFinalTarget | undefined {
  if (!node || !isUseCaseNodeType(node.type)) return undefined
  const data = (node.data ?? {}) as Readonly<Record<string, unknown>>
  // A failed node offers Continue instead — never both.
  if (data.executionStatus === "failed") return undefined
  const take = usecaseTakeOnShow(data)
  if (take?.quality !== "proxy" || typeof take.jobId !== "string" || !isValidUuid(take.jobId)) return undefined
  const settings = usecaseRunSettings(data)
  return { jobId: take.jobId, ...(settings ? { settings } : {}) }
}

/** Render final is offered on `node` (it may still wait for a run under way: the bar shows it busy). */
export function usecaseRenderFinalOffered(node: Pick<WorkflowNode, "type" | "data"> | undefined): boolean {
  return previewTakeRun(node) !== undefined
}

/**
 * The run a Render final of `node` continues NOW: the wrapper of the take on
 * show when that take is a Preview, with the settings that run was built from.
 * Undefined when there is none to continue, or while a run of the node is under way.
 */
export function usecaseRenderFinalTarget(node: Pick<WorkflowNode, "type" | "data"> | undefined): UseCaseRenderFinalTarget | undefined {
  if (BUSY.has(String((node?.data as { executionStatus?: unknown } | undefined)?.executionStatus ?? ""))) return undefined
  return previewTakeRun(node)
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
