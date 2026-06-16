/**
 * Single-node in-flight restore after a page reload (Gap 3).
 *
 * A per-node Run's run-state (`executionStatus`, `currentJobId`,
 * `currentJobProgress`) lives in `TRANSIENT_RUNTIME_KEYS` and is stripped on
 * save by design (persisting it caused an autosave-freeze bug). After a reload
 * the canvas therefore loses the running node. The `jobs` table is the
 * authoritative source of in-flight state; the editor's load path fetches it via
 * `GET /v1/workflows/:id/executions` (which merges standalone single-node jobs)
 * and re-hydrates the canvas IN MEMORY using the two pure helpers here.
 *
 * Backend Phase 2 keys each single-node job summary's (single) nodeState by the
 * canvas `node_id`, and includes `{ nodeId, jobId, progress, status, nodeType }`.
 */

/** Node-execution timeout horizon — mirrors backend `NODE_TIMEOUT_MS` (30 min).
 *  A single-node job older than this is almost certainly stuck; restoring a poll
 *  for it would never end (a hung job keeps returning 200). Leave it to the
 *  backend reconcile cron to terminalize instead. */
export const SINGLE_NODE_RESTORE_MAX_AGE_MS = 30 * 60 * 1000

/** Structural subset of the `GET /v1/workflows/:id/executions` list items. */
export interface ActiveExecItem {
  readonly id: string
  readonly triggerType?: string
  readonly status?: string
  readonly createdAt: string
  readonly nodeStates?: Record<string, unknown>
}

/** A single-node job that is safe to re-hydrate onto the canvas. */
export interface RestorableSingleNodeJob {
  readonly nodeId: string
  readonly jobId: string
  readonly nodeType: string
  readonly progress: number
  readonly status: "running" | "pending"
}

interface SingleNodeState {
  nodeId?: string | null
  jobId?: string
  progress?: number
  status?: string
  nodeType?: string
}

/** The (single) nodeState of a single-node job summary, or undefined. */
function soleNodeState(item: ActiveExecItem): SingleNodeState | undefined {
  return Object.values(item.nodeStates ?? {})[0] as SingleNodeState | undefined
}

/**
 * From the merged executions-list response, pick the active single-node jobs
 * (per-node Run) that can be SAFELY restored to the canvas after a reload.
 *
 * Skips (documented limitations / safety):
 *  - non single-node items (orchestrator `manual`, `mcp`) — handled elsewhere
 *  - jobs with no canvas `node_id` (SDK/legacy rows keyed by job id)
 *  - jobs whose node isn't on the canvas (deleted / sub-workflow)
 *  - FAN-OUT: a `list`/`loop` node, or >1 active job mapping to one node
 *    (restoring would collapse N parallel results to 1)
 *  - jobs older than the node-timeout horizon (stuck → backend reconcile owns)
 */
export function collectRestorableSingleNodeJobs(
  items: readonly ActiveExecItem[],
  nodes: readonly { id: string; type?: string }[],
  nowMs: number,
): RestorableSingleNodeJob[] {
  const nodeById = new Map(nodes.map((n) => [n.id, n]))

  // Count active single-node jobs per node so we can drop fan-out (N→1).
  const jobsPerNode = new Map<string, number>()
  for (const item of items) {
    if (item.triggerType !== "single-node") continue
    const nid = soleNodeState(item)?.nodeId
    if (nid) jobsPerNode.set(nid, (jobsPerNode.get(nid) ?? 0) + 1)
  }

  const out: RestorableSingleNodeJob[] = []
  const seen = new Set<string>()
  for (const item of items) {
    if (item.triggerType !== "single-node") continue

    const state = soleNodeState(item)
    const nodeId = state?.nodeId
    if (!nodeId) continue // no canvas node_id → can't place it

    if (seen.has(nodeId)) continue // one restore per node
    const node = nodeById.get(nodeId)
    if (!node) continue // deleted / sub-workflow node

    // Fan-out: list/loop nodes and any node targeted by >1 active job.
    if (node.type === "list" || node.type === "loop") continue
    if ((jobsPerNode.get(nodeId) ?? 0) > 1) continue

    // Stuck-job age bound — let the backend reconcile cron terminalize it.
    const ageMs = nowMs - new Date(item.createdAt).getTime()
    if (Number.isFinite(ageMs) && ageMs > SINGLE_NODE_RESTORE_MAX_AGE_MS) continue

    seen.add(nodeId)
    out.push({
      nodeId,
      jobId: state?.jobId ?? item.id,
      nodeType: node.type ?? state?.nodeType ?? "unknown",
      progress: typeof state?.progress === "number" ? state.progress : 0,
      status: state?.status === "pending" ? "pending" : "running",
    })
  }
  return out
}

/**
 * Re-hydrate the canvas run-state for restored single-node jobs. Writes ONLY
 * transient keys (`executionStatus`, `currentJobId`, `currentJobProgress`) so it
 * never enters the persisted graph (every save path strips them) — multi-tab
 * safe. `currentJobId` is the load-bearing one: the restored poll's abandon
 * guard (`shouldAbandonNode`) detaches unless `data.currentJobId === jobId`.
 */
export function applySingleNodeJobRestore<
  T extends { id: string; data?: Record<string, unknown> | undefined },
>(nodes: readonly T[], jobs: readonly RestorableSingleNodeJob[]): T[] {
  if (jobs.length === 0) return nodes as T[]
  const jobByNode = new Map(jobs.map((j) => [j.nodeId, j]))
  return nodes.map((node) => {
    const job = jobByNode.get(node.id)
    if (!job) return node
    return {
      ...node,
      data: {
        ...(node.data ?? {}),
        executionStatus: job.status,
        currentJobId: job.jobId,
        currentJobProgress: job.progress,
      },
    }
  })
}
