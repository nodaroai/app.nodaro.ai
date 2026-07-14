/**
 * Reconcile COMPLETED single-node jobs onto canvas nodes that are missing
 * their result after a reload.
 *
 * Why this exists (distinct from `reconcile-node-results.ts`)
 * ----------------------------------------------------------
 * `reconcileWorkflowNodeResults` only back-fills EXTRA variants onto nodes that
 * are ALREADY `executionStatus === "completed"` with ≥1 saved result — it can't
 * recover a node that has NO result at all, and it's variant-array shaped
 * (imageUrls/audioUrls), so single-result video nodes (`output_data.videoUrl`)
 * fall through entirely.
 *
 * The gap it leaves (this fixes): a long single-node Run (generate-video-pro can
 * run 10-40+ min) whose in-memory poll dies when the user reloads / closes the
 * tab / navigates away. The job finishes in the background; the result lands in
 * `jobs.output_data` + My Library — but the canvas node never sees it, because
 * its transient run-state (`executionStatus`, `currentJobId`) is stripped on
 * save and no path reconciles a *completed* single-node job's result on reopen.
 * The user opens the workflow and the node is empty.
 *
 * What this does
 * --------------
 * On load: list the workflow's recently-COMPLETED single-node jobs (each keyed
 * by canvas `node_id`), and for every node that has no result yet, fetch that
 * job's `output_data` and write its single result (`videoUrl` / `imageUrl` /
 * `audioUrl`). Guarded to never overwrite a node the user already has a result
 * on or has marked completed (mirrors `applyCompletedExecutionResults`), so it's
 * idempotent and multi-tab safe.
 */

import { getJobStatusLean } from "./api"
import type { GeneratedResult, WorkflowNode } from "@/types/nodes"

/** The single-entry nodeState a completed single-node job carries (backend
 *  `jobToExecutionSummary` keys it by canvas node_id, falls back to job id). */
interface SoleNodeState {
  nodeId?: string | null
  jobId?: string
  status?: string
}

interface ExecItemLike {
  readonly id: string
  readonly triggerType?: string
  readonly nodeStates?: Record<string, unknown>
}

export interface CompletedJobRef {
  readonly nodeId: string
  readonly jobId: string
}

export interface NodeResultUpdate {
  readonly nodeId: string
  readonly updates: Record<string, unknown>
}

/**
 * Pick the latest completed single-node job PER node from a
 * `listWorkflowExecutions(status:"completed")` response. Items arrive newest-
 * first, so the first occurrence of each node_id is its most recent completion.
 * Skips items with no canvas node_id (SDK/legacy rows) and non-single-node
 * items (orchestrator executions carry their own results in node_states).
 */
export function pickLatestCompletedJobPerNode(items: readonly ExecItemLike[]): CompletedJobRef[] {
  const byNode = new Map<string, string>()
  for (const item of items) {
    if (item.triggerType !== "single-node") continue
    const st = Object.values(item.nodeStates ?? {})[0] as SoleNodeState | undefined
    const nodeId = st?.nodeId
    if (!nodeId || byNode.has(nodeId)) continue
    byNode.set(nodeId, st?.jobId ?? item.id)
  }
  return [...byNode].map(([nodeId, jobId]) => ({ nodeId, jobId }))
}

/** True when the node already carries a generated result — don't clobber it. */
function nodeHasResult(data: Record<string, unknown>): boolean {
  if (data.executionStatus === "completed") return true
  if (data.generatedVideoUrl || data.generatedImageUrl || data.generatedAudioUrl || data.sourceImageUrl) return true
  const gr = data.generatedResults as readonly GeneratedResult[] | undefined
  return Array.isArray(gr) && gr.length > 0
}

/**
 * Map a completed job's `output_data` → the node-data patch that writes its
 * single result. Mirrors `handleJobCompleted` (poll-job.ts): the store's
 * `generated*Url` field + a one-entry `generatedResults` version carrying the
 * jobId, `activeResultIndex: 0`, `executionStatus: "completed"`. Returns null
 * when the job produced no recognizable media URL.
 */
export function buildCompletedResultPatch(
  nodeType: string | undefined,
  output: Record<string, unknown> | null | undefined,
  jobId: string,
  timestamp: string,
): Record<string, unknown> | null {
  if (!output) return null
  const videoUrl = typeof output.videoUrl === "string" ? output.videoUrl : undefined
  const imageUrl = typeof output.imageUrl === "string" ? output.imageUrl : undefined
  const audioUrl = typeof output.audioUrl === "string" ? output.audioUrl : undefined
  const url = videoUrl ?? imageUrl ?? audioUrl
  if (!url) return null

  const thumbnailUrl = typeof output.thumbnailUrl === "string" ? output.thumbnailUrl : undefined
  const result: GeneratedResult = { url, thumbnailUrl, timestamp, jobId }

  const patch: Record<string, unknown> = {
    executionStatus: "completed",
    generatedResults: [result],
    activeResultIndex: 0,
  }
  if (videoUrl) patch.generatedVideoUrl = videoUrl
  else if (imageUrl) {
    // Entity nodes source their portrait from sourceImageUrl (parity with
    // applyCompletedExecutionResults); every other node uses generatedImageUrl.
    if (nodeType && ["character", "face", "object", "location"].includes(nodeType)) patch.sourceImageUrl = imageUrl
    else patch.generatedImageUrl = imageUrl
  } else if (audioUrl) patch.generatedAudioUrl = audioUrl
  return patch
}

/**
 * Pure core: given the candidate {nodeId, jobId} refs, the current nodes, and a
 * job-output fetcher, return the node-data patches to apply. Skips nodes that
 * already have a result (idempotent) and jobs that aren't actually completed or
 * carry no media. `nowIso` is injected so the caller controls the timestamp
 * (tests stay deterministic).
 */
export async function computeCompletedJobPatches(
  refs: readonly CompletedJobRef[],
  nodes: readonly WorkflowNode[],
  fetchOutput: (jobId: string) => Promise<{ status: string; output_data?: Record<string, unknown> | null } | null>,
  nowIso: string,
): Promise<NodeResultUpdate[]> {
  const nodeById = new Map(nodes.map((n) => [n.id, n]))
  const out: NodeResultUpdate[] = []
  for (const { nodeId, jobId } of refs) {
    const node = nodeById.get(nodeId)
    if (!node) continue // deleted / sub-workflow node
    const data = (node.data ?? {}) as Record<string, unknown>
    if (nodeHasResult(data)) continue // respect existing result / user edits

    let job: Awaited<ReturnType<typeof fetchOutput>>
    try {
      job = await fetchOutput(jobId)
    } catch {
      continue // best-effort — a lookup hiccup shouldn't block load
    }
    if (!job || job.status !== "completed") continue

    const patch = buildCompletedResultPatch(node.type, job.output_data ?? null, jobId, nowIso)
    if (patch) out.push({ nodeId, updates: patch })
  }
  return out
}

/**
 * One-shot load-path helper. Lists the workflow's recently-completed single-node
 * jobs, computes the patches, and applies them via `updateNodeData`. Fully
 * best-effort: any failure leaves the workflow loaded and untouched.
 */
export async function reconcileCompletedSingleNodeJobs(
  workflowId: string,
  nodes: readonly WorkflowNode[],
  updateNodeData: (nodeId: string, updates: Record<string, unknown>) => void,
  deps: {
    listCompleted: (workflowId: string) => Promise<{ data: ExecItemLike[] }>
    fetchOutput?: (jobId: string) => Promise<{ status: string; output_data?: Record<string, unknown> | null }>
    nowIso?: string
  },
): Promise<void> {
  try {
    const { data: items } = await deps.listCompleted(workflowId)
    const refs = pickLatestCompletedJobPerNode(items)
    if (refs.length === 0) return
    const fetchOutput =
      deps.fetchOutput ?? (async (jobId: string) => (await getJobStatusLean(jobId)) as { status: string; output_data?: Record<string, unknown> | null })
    const patches = await computeCompletedJobPatches(refs, nodes, fetchOutput, deps.nowIso ?? new Date().toISOString())
    for (const p of patches) updateNodeData(p.nodeId, p.updates)
  } catch {
    console.warn("[reconcile-completed-jobs] reconcile skipped; long-job results may be missing until re-run")
  }
}
