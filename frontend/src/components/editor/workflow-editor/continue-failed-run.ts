/**
 * "Continue from failed": a server run of the open workflow that FAILED,
 * continued from where it stopped (`POST /v1/workflows/:id/run` with
 * `continueFromExecutionId` + `continueMode: "from-failed"`). The server keeps
 * every node that run completed (handed on, never run or charged again) and
 * runs what is left of the nodes it considers: the nodes the first run of its
 * chain was started on (`nodeScope`; every node when it was started on every
 * node), plus what the run left failed or held back, and what those need
 * upstream. The editor predicts that set by the server's own rule
 * (`@nodaro/render-rules` `fromFailedConsidered` / `fromFailedClosedRunSet`),
 * from the failed run's states and scope, to price the confirm, to mark what
 * is expected to run, and to clear only what the server will refill.
 *
 * Every answer has its own next step:
 *  - 202: the run is followed like every other server run;
 *  - `already_running`: the run already going is followed;
 *  - `continuation_superseded`: a newer continuation of the run decides. Failed:
 *    the toast offers to continue THAT one. Completed: the work is done;
 *  - `continuation_preview_pending`: the newest continuation stopped at a
 *    Preview review. One render: its Render final, the editor's own flow, as a
 *    continuation of that run. Several renders, or a Tighten Episode review:
 *    the one run the server names (`next`) finishes them, offered from the toast;
 *  - `continuation_subset_required`: nothing is left to run, which is said as done.
 *
 * The start-up mirrors a run of named nodes (`startSubsetRun`): its checks,
 * the balance check for a UGC part, linked videos fetched, the read-only
 * re-check, the save (a refused one stops it), the optimistic marks rolled
 * back on a refusal. Two things differ. The confirm is ALWAYS asked, naming
 * every node that runs with its price: a node the failed run did not complete
 * runs and is charged again, one run by hand with ▶ since included. And the
 * node data a run clears (list results, connected List rows) is cleared only
 * once the server has started it, and only on the nodes it runs: the expected
 * refusals start nothing and must leave the canvas as it was.
 */
import { completedFor, fromFailedClosedRunSet, fromFailedConsidered, type FromFailedNodeState } from "@nodaro/render-rules"
import { CONTINUATION_SUBSET_REQUIRED, withRunOverrides } from "@nodaro/shared/nodes"
import { toast } from "sonner"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { getWorkflowExecution, runWorkflow, WorkflowAlreadyRunningError, withDedupRaceRetry } from "@/lib/api"
import { generateIdempotencyKey } from "@/lib/idempotency-key"
import { saveRefused } from "@/lib/save-result"
import { tx, type MessageKey } from "@/lib/i18n"
import {
  ContinuationPreviewPendingError,
  ContinuationRefusedError,
  ContinuationSupersededError,
  type HeldFinalRun,
} from "@/lib/run-workflow-errors"
import type { WorkflowEdge, WorkflowNode } from "@/types/nodes"
import type { ExecutionContext } from "./types"
import { collapseExpandedClones } from "./execution-graph"
import { rejectAllManualEdits } from "./execute-node"
import { ensureVideoLinksBeforeRun } from "./video-link-run-gate"
import { liveExecutable } from "./run-from-here-set"
import { previewRunnable } from "./preview-gate"
import type { UgcRunPriced } from "./ugc-run-estimate"
import {
  attachToRunningExecution,
  checkRunBalance,
  clearConnectedListRows,
  clickLiveness,
  confirmRunOrAbort,
  hasActiveWorkflowStream,
  refuseWhileReadOnly,
  resetNodeAccumulation,
  streamBackendExecution,
} from "./run-handlers"

/** What the editor hands a continuation: its run plumbing, and its Render final. */
export interface ContinueRunDeps {
  readonly ctx: ExecutionContext
  readonly projectId: string | undefined
  readonly save: (pid: string) => Promise<unknown>
  readonly setIsRunning: (v: boolean) => void
  readonly onExecutionStarted?: (id: string) => void
  readonly onExecutionEnded?: () => void
  /** The editor's Render final of `renderId`, continuing `continueFrom` (`handleRenderFinal`). */
  readonly renderFinal: (renderId: string, continueFrom: string) => Promise<void>
}

/** One continuation request, and what it is expected to run (priced and marked on the canvas). */
interface ContinuationPlan {
  readonly continueFrom: string
  readonly continueMode?: "from-failed"
  readonly nodeIds?: readonly string[]
  readonly inputOverrides?: HeldFinalRun["inputOverrides"]
  /** The node states of the run it continues (empty when it names its nodes). */
  readonly states: StatesOf
  /** The executable nodes it is expected to run, on the graph it runs (`nodes`, overrides applied), building on `states`. */
  readonly expected: (nodes: WorkflowNode[], edges: readonly WorkflowEdge[], states: StatesOf) => WorkflowNode[]
  readonly trigger: "continue-failed" | "finish-review"
  readonly startedToast: MessageKey
}

/** One continuation at a time: a second click while one is being started (its run read included) is dropped. */
let continuing = false

/** The node states of a run, as `getWorkflowExecution` returns them. */
type StatesOf = Readonly<Record<string, FromFailedNodeState | undefined>>

// The editor's Continue from failed names no nodes: a placeholder counts as completed, as on the server.
const completedIn = (states: StatesOf) => (id: string) => completedFor(states[id], false)

/** The run a continue-from-failed is asked of, as the prediction reads it. */
export interface FromFailedRequest {
  /** The nodes its chain's first run was started on (`nodeScope`); `null`: every node. */
  readonly scope: readonly string[] | null
  /** Its node states. */
  readonly states: StatesOf
}

/**
 * The executable nodes a continue-from-failed of `request` is expected to run,
 * built on `base` (the request's own states, or those of the newer
 * continuation the server built on, `continuedFrom`): the server's rule — of
 * the nodes the chain's first run was started on plus what either run left
 * unfinished, every one `base` did not complete, with the incomplete nodes
 * they need upstream. No scope: every executable node `base` did not
 * complete. Pure.
 */
export function expectedFromFailed(
  nodes: WorkflowNode[],
  edges: readonly WorkflowEdge[],
  request: FromFailedRequest,
  base: StatesOf = request.states,
): WorkflowNode[] {
  const order = nodes.map((n) => n.id)
  const considered = fromFailedConsidered(order, request.scope, [{ nodeStates: request.states }, { nodeStates: base }])
  const runs = new Set(fromFailedClosedRunSet(order, considered, { nodes, edges }, { nodeStates: base }))
  return liveExecutable(nodes).filter((n) => runs.has(n.id))
}

/**
 * The List nodes whose connected rows a run clears: those every connected
 * column of which is fed by a node the run runs, so the run fills them again.
 * A List fed by a node the run hands on keeps its rows (nothing would refill
 * them). Pure.
 */
export function listsRefilledBy(nodes: readonly WorkflowNode[], runs: ReadonlySet<string>): WorkflowNode[] {
  return nodes.filter((n) => {
    if (n.type !== "list") return false
    const columns = (n.data as { columns?: unknown }).columns
    const sources = Array.isArray(columns)
      ? columns.flatMap((c) => {
          const id = (c as { connectedSourceId?: unknown } | null)?.connectedSourceId
          return typeof id === "string" && id ? [id] : []
        })
      : []
    return sources.length > 0 && sources.every((id) => runs.has(id))
  })
}

/** Run `body` holding the one-continuation lock; a second click meanwhile is dropped. */
async function holdingLock(body: () => Promise<void>): Promise<void> {
  if (continuing) return
  continuing = true
  try {
    await body()
  } finally {
    continuing = false
  }
}

/** Continue the failed run `executionId` of the open workflow from where it stopped. */
export function handleContinueFailedRun(executionId: string, d: ContinueRunDeps): Promise<void> {
  return holdingLock(async () => {
    if (hasActiveWorkflowStream()) {
      toast.info(tx("run.alreadyRunning"))
      return
    }
    const { workflowId, alive } = clickLiveness(d.ctx)
    if (!workflowId) {
      toast.error(tx("run.saveBeforeRunning"))
      return
    }
    let request: FromFailedRequest
    try {
      const exec = await getWorkflowExecution(executionId)
      // A toast from another workflow's run, or a canvas that moved on: nothing to do here.
      if (!alive() || exec.workflowId !== workflowId) return
      // A server from before the scope was handed on sends none: every node, as it then ran.
      request = { scope: exec.nodeScope ?? null, states: (exec.nodeStates ?? {}) as StatesOf }
    } catch (err) {
      if (!alive()) return
      toast.error(tx("run.failedToStartExecution"), { description: err instanceof Error ? err.message : tx("run.unknownError") })
      return
    }
    await runContinuation(d, workflowId, alive, {
      continueFrom: executionId,
      continueMode: "from-failed",
      states: request.states,
      expected: (nodes, edges, base) => expectedFromFailed(nodes, edges, request, base),
      trigger: "continue-failed",
      startedToast: "continueFailed.started",
    })
  })
}

/** The run the server named to finish what holds a Preview review (`next`), started from the toast. */
export function finishHeldPreviews(next: HeldFinalRun, d: ContinueRunDeps): Promise<void> {
  return holdingLock(async () => {
    if (hasActiveWorkflowStream()) {
      toast.info(tx("run.alreadyRunning"))
      return
    }
    const { workflowId, alive } = clickLiveness(d.ctx)
    if (!workflowId) return
    const ids = new Set(next.nodeIds)
    await runContinuation(d, workflowId, alive, {
      continueFrom: next.continueFromExecutionId,
      nodeIds: next.nodeIds,
      inputOverrides: next.inputOverrides,
      states: {},
      expected: (nodes) => liveExecutable(nodes).filter((n) => ids.has(n.id)),
      trigger: "finish-review",
      startedToast: "continueFailed.finishStarted",
    })
  })
}

/**
 * The states of the run a 202 says the continuation was built on: the one sent,
 * or a newer continuation of it (`continuedFrom`), which completed more. `null`
 * when that newer run cannot be read.
 */
async function builtOnStates(plan: ContinuationPlan, continuedFrom: string | undefined): Promise<StatesOf | null> {
  if (!continuedFrom || continuedFrom === plan.continueFrom || plan.continueMode !== "from-failed") return plan.states
  try {
    return ((await getWorkflowExecution(continuedFrom)).nodeStates ?? {}) as StatesOf
  } catch {
    return null
  }
}

async function runContinuation(d: ContinueRunDeps, workflowId: string, alive: () => boolean, plan: ContinuationPlan): Promise<void> {
  const { ctx, setIsRunning } = d
  {
    const st = useWorkflowStore.getState()
    const graph = plan.inputOverrides ? withRunOverrides(st.nodes, plan.inputOverrides) : st.nodes
    // What it runs, the stop rule's closure left out: the confirm names these, with their price.
    const exec = previewRunnable(plan.expected(graph, st.edges, plan.states), graph, st.edges)
    const keptIds = liveExecutable(graph).map((n) => n.id).filter(completedIn(plan.states))
    let confirmed = null as UgcRunPriced | null
    const onPriced = (priced: UgcRunPriced) => { confirmed = priced }
    // Always asked, naming every node that runs with its price (`confirmRunOrAbort`'s continuation branch).
    if (!(await confirmRunOrAbort(ctx, exec, graph, st.edges, plan.trigger, true, undefined, undefined, { onPriced, alive, keptIds }))) return
    if (confirmed && (!(await checkRunBalance(ctx, { confirmed, executable: exec, nodes: graph, edges: st.edges })) || !alive())) return
    if (!(await ensureVideoLinksBeforeRun(exec.map((n) => n.id), setIsRunning)) || !alive()) return
  }
  if (refuseWhileReadOnly()) return
  rejectAllManualEdits()
  const { nodes, edges } = collapseExpandedClones()
  // The stop rule's closure never runs (the server skips it too): never reset, flipped or counted.
  const runGraph = plan.inputOverrides ? withRunOverrides(nodes, plan.inputOverrides) : nodes
  const runnable = (states: StatesOf) => new Set(previewRunnable(plan.expected(runGraph, edges, states), runGraph, edges).map((n) => n.id))
  const expectedIds = runnable(plan.states)
  const markedIds = nodes.filter((n) => expectedIds.has(n.id)).map((n) => n.id)

  const { markNodesStatus } = useWorkflowStore.getState()
  // Only the marks go on before the answer: they are not saved. The node data
  // is cleared only once the server has started the run (below), so a refusal,
  // which runs nothing, leaves every node as it was.
  markNodesStatus(markedIds, "pending")
  setIsRunning(true)
  const rollBack = () => {
    setIsRunning(false)
    markNodesStatus(markedIds, undefined)
  }
  // The server runs the SAVED workflow: a canvas it cannot save is not continued.
  const wasDirty = useWorkflowStore.getState().isDirty
  if (wasDirty) {
    let saved: unknown = { success: false }
    try {
      if (d.projectId) saved = await d.save(d.projectId)
    } catch {
      saved = { success: false }
    }
    if (saveRefused(saved)) {
      rollBack()
      toast.error(tx("continueFailed.saveFailed"))
      return
    }
  }
  toast.info(tx(plan.startedToast))

  let result: { executionId: string; continuedFrom?: string }
  try {
    const idempotencyKey = generateIdempotencyKey()
    result = await withDedupRaceRetry(() =>
      runWorkflow(workflowId, plan.nodeIds ? [...plan.nodeIds] : undefined, idempotencyKey, {
        ...(plan.inputOverrides ? { inputOverrides: plan.inputOverrides } : {}),
        continueFromExecutionId: plan.continueFrom,
        ...(plan.continueMode ? { continueMode: plan.continueMode } : {}),
      }),
    )
  } catch (err: unknown) {
    if (err instanceof WorkflowAlreadyRunningError) {
      toast.info(tx("run.alreadyRunning"))
      d.onExecutionStarted?.(err.executionId)
      void attachToRunningExecution(err.executionId, ctx, setIsRunning, d.onExecutionEnded, () => markNodesStatus(markedIds, undefined))
      return
    }
    rollBack()
    answerRefusal(err, d)
    return
  }

  // Started: the editor owns this run from now on (before any further wait).
  d.onExecutionStarted?.(result.executionId)
  // The run may build on a newer continuation of the one sent
  // (`continuedFrom`): what that one completed is handed on, never run, so it
  // keeps its data and loses its mark. When that run cannot be read, nothing
  // is cleared: a node it runs then shows its old rows until its new ones land.
  const base = await builtOnStates(plan, result.continuedFrom)
  // Read on the canvas as it is now, and only while it is still this click's.
  if (alive()) {
    const runs = base === null ? new Set<string>() : base === plan.states ? expectedIds : runnable(base)
    const handedOn = markedIds.filter((id) => !runs.has(id))
    if (base !== null && handedOn.length > 0) markNodesStatus(handedOn, undefined)
    const now = useWorkflowStore.getState().nodes
    clearConnectedListRows(listsRefilledBy(now, runs))
    resetNodeAccumulation(now.filter((n) => runs.has(n.id)), { preserveHistory: true })
  }
  streamBackendExecution(result.executionId, ctx, setIsRunning, d.onExecutionEnded)
}

/** The answers that name another run, or a Preview to finish first; any other error is said as is. */
function answerRefusal(err: unknown, d: ContinueRunDeps): void {
  if (err instanceof ContinuationSupersededError) {
    const by = err.supersededBy
    if (by.status === "completed") {
      toast.success(tx("continueFailed.alreadyDone"))
      return
    }
    toast.info(tx("continueFailed.supersededFailed"), {
      duration: 12_000,
      action: { label: tx("continueFailed.continueNewer"), onClick: () => void handleContinueFailedRun(by.executionId, d) },
    })
    return
  }
  if (err instanceof ContinuationPreviewPendingError) {
    answerPreviewPending(err, d)
    return
  }
  // Every node the run was to run already completed: nothing is left, which is not a failure.
  if (err instanceof ContinuationRefusedError && err.code === CONTINUATION_SUBSET_REQUIRED) {
    toast.success(tx("continueFailed.nothingLeft"))
    return
  }
  toast.error(tx("run.failedToStartExecution"), {
    description: err instanceof ContinuationRefusedError || err instanceof Error ? err.message : tx("run.unknownError"),
  })
}
function answerPreviewPending(err: ContinuationPreviewPendingError, d: ContinueRunDeps): void {
  const { nodes } = useWorkflowStore.getState()
  const labelOf = (id: string) => {
    const label = (nodes.find((n) => n.id === id)?.data as { label?: unknown } | undefined)?.label
    return typeof label === "string" && label.trim() ? label : id
  }
  const [only] = err.renderNodeIds
  // One render and nothing else: its Render final is the next step, continuing that run.
  if (err.renderNodeIds.length === 1 && err.reviewNodeIds.length === 0 && only && nodes.some((n) => n.id === only)) {
    toast.info(tx("continueFailed.previewPendingRender", { node: labelOf(only) }))
    void d.renderFinal(only, err.executionId)
    return
  }
  const held = [...err.renderNodeIds, ...err.reviewNodeIds].map(labelOf).join(", ")
  const next = err.next
  toast.info(tx("continueFailed.previewPendingMany", { nodes: held }), {
    duration: 12_000,
    ...(next ? { action: { label: tx("continueFailed.finishReview"), onClick: () => void finishHeldPreviews(next, d) } } : {}),
  })
}
