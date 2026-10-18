/**
 * Render final on a use-case node (Tighten Episode, decided 2026-10-13). The
 * node's render lives in its own hidden run, so its Render final is never the
 * render nodes' quality override (which would re-run the whole node and pay
 * its fee again): it is a continuation of that run, `useCaseContinue:
 * { mode: "render-final", jobId }` on the node — its render at final with the
 * reviewer's edit, captions, music and merge once, no fee — and then every
 * node after it, which waited for this final.
 *
 * The continuation is an input override of THIS run only (as the app lane
 * sends it; use-case-render-final-set.ts), never a value saved on the node: a
 * saved one would make the node's next plain Run a Render final again. The
 * server's executor of the node sends the continue with the node's saved
 * `editedEdl`, so the save before the run must succeed.
 */
import { toast } from "sonner"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { runWorkflow, WorkflowAlreadyRunningError, withDedupRaceRetry } from "@/lib/api"
import { generateIdempotencyKey } from "@/lib/idempotency-key"
import { flushPendingReviews } from "@/lib/edl-review/write-review"
import { tx } from "@/lib/i18n"
import type { ExecutionContext } from "./types"
import { collapseExpandedClones } from "./execution-graph"
import { rejectAllManualEdits } from "./execute-node"
import { previewRunnable } from "./preview-gate"
import type { UgcRunPriced } from "./ugc-run-estimate"
import { usecaseRenderFinalRun } from "./use-case-render-final-set"
import { ensureVideoLinksBeforeRun } from "./video-link-run-gate"
import {
  attachToRunningExecution,
  checkRunBalance,
  clearConnectedListRows,
  confirmRunOrAbort,
  refuseWhileReadOnly,
  resetNodeAccumulation,
  streamBackendExecution,
  warnUnderMinRows,
  type BalanceCheckRun,
} from "./run-handlers"

/** A save that came back refused (`SaveResult`), as opposed to one that did not say. */
const saveFailed = (result: unknown): boolean =>
  typeof result === "object" && result !== null && (result as { success?: unknown }).success === false

/**
 * Starts the Render final of use-case node `nodeId`. Called by the editor's
 * Render final handler, under its lock, for a use-case node: every surface's
 * Render final (the node's bar, the review inspector) reaches it there.
 */
export async function runUseCaseRenderFinal(
  nodeId: string,
  ctx: ExecutionContext,
  projectId: string | undefined,
  save: (pid: string) => Promise<unknown>,
  setIsRunning: (v: boolean) => void,
  alive: () => boolean,
  onExecutionStarted?: (id: string) => void,
  onExecutionEnded?: () => void,
): Promise<void> {
  // An edit still in the review's debounce is in the plan the run reads.
  flushPendingReviews()
  const st = useWorkflowStore.getState()
  const workflowId = st.workflowId
  if (!workflowId) {
    toast.error(tx("run.saveBeforeRunning"))
    return
  }
  {
    const run = usecaseRenderFinalRun(nodeId, st.nodes, st.edges)
    if (!run) return
    let confirmed = null as UgcRunPriced | null
    const onPriced = (priced: UgcRunPriced) => { confirmed = priced }
    if (!(await confirmRunOrAbort(ctx, run.executable, run.graph, st.edges, "render-final", true, false, nodeId, { onPriced, alive }))) return
    const balanceRun: BalanceCheckRun | null = confirmed ? { confirmed, executable: run.executable, nodes: run.graph, edges: st.edges } : null
    if (balanceRun && (!(await checkRunBalance(ctx, balanceRun)) || !alive())) return
    if (!(await ensureVideoLinksBeforeRun(run.executable.map((n) => n.id), setIsRunning)) || !alive()) return
  }
  if (refuseWhileReadOnly()) return
  rejectAllManualEdits()
  const { nodes, edges } = collapseExpandedClones()
  const run = usecaseRenderFinalRun(nodeId, nodes, edges)
  if (!run) return
  warnUnderMinRows(nodes.filter((n) => run.runSet.has(n.id)))
  const runnableIds = new Set(previewRunnable(run.executable, run.graph, edges).map((n) => n.id))
  if (runnableIds.size === 0) {
    toast.error(tx("run.noExecutableDownstream"))
    return
  }
  const executableNodes = nodes.filter((n) => runnableIds.has(n.id))
  const executableIds = executableNodes.map((n) => n.id)

  const wasDirty = useWorkflowStore.getState().isDirty
  if (wasDirty && !projectId) {
    toast.error(tx("renderFinal.saveFailed"))
    return
  }
  // Cleared only once nothing above can stop the run; every way out below
  // that starts nothing puts it back (`giveUp`).
  const undoRows = clearConnectedListRows(nodes)
  const undoReset = resetNodeAccumulation(executableNodes, { preserveHistory: true })
  const { markNodesStatus } = useWorkflowStore.getState()
  markNodesStatus(executableIds, "pending")
  setIsRunning(true)
  const giveUp = () => {
    undoReset()
    undoRows()
    setIsRunning(false)
    markNodesStatus(executableIds, undefined)
  }

  // The save MUST succeed: the server's run sends the node's saved edit.
  if (wasDirty && projectId) {
    let saved: unknown
    try {
      saved = await save(projectId)
    } catch {
      saved = { success: false }
    }
    if (saveFailed(saved)) {
      giveUp()
      toast.error(tx("renderFinal.saveFailed"))
      return
    }
  }

  toast.info(tx("renderFinal.toastFinal"), { description: tx("run.nodesToRun", { count: executableNodes.length }) })
  try {
    const idempotencyKey = generateIdempotencyKey()
    const result = await withDedupRaceRetry(() =>
      runWorkflow(workflowId, [...run.runSet], idempotencyKey, { inputOverrides: run.overrides }),
    )
    onExecutionStarted?.(result.executionId)
    streamBackendExecution(result.executionId, ctx, setIsRunning, onExecutionEnded)
  } catch (err: unknown) {
    if (err instanceof WorkflowAlreadyRunningError) {
      // Another run holds the workflow: this final started nothing, so the
      // canvas data goes back; the marks follow the run it attaches to.
      undoReset()
      undoRows()
      toast.info(tx("renderFinal.inProgress"))
      onExecutionStarted?.(err.executionId)
      void attachToRunningExecution(err.executionId, ctx, setIsRunning, onExecutionEnded, () => markNodesStatus(executableIds, undefined))
      return
    }
    giveUp()
    toast.error(tx("run.failedToStartExecution"), {
      description: err instanceof Error ? err.message : tx("run.unknownError"),
    })
  }
}
