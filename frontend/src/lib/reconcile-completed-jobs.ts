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
import { COMPOSER_PLAN_MAP } from "@nodaro/shared"
import { findRevision, resolveSceneCompletion } from "@/lib/scene3d/revisions"
import { planRevisionId } from "@/lib/scene3d/plan-view"
import type { GeneratedResult, Scene3DRevisionEntry, WorkflowNode } from "@/types/nodes"

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

/** True when this node's result is a Scene3D plan rather than a media URL. */
export function isScene3DNodeType(nodeType: string | undefined): boolean {
  return COMPOSER_PLAN_MAP[nodeType ?? ""]?.planType === "3d-scene"
}

/**
 * True when the node already carries a generated result — don't clobber it.
 *
 * `scenePlan` is deliberately NOT on this list, and must not be added. Holding
 * a plan is the NORMAL state of a scene node — it keeps the previous revision
 * on screen while a job runs, and an edit node adopts its upstream scene before
 * running — so treating that as "already has a result" would make the Scene3D
 * recovery below dead code for exactly the runs it exists to recover. Scene
 * nodes get a stronger guard instead: `buildScene3DRecoveryPatch` skips a
 * revision already in history (idempotent across reloads) and routes the rest
 * through `resolveSceneCompletion`, which protects a manual edit made AFTER the
 * job started — something a "has any plan" test cannot see.
 * (`reconcile-completed-jobs.test.ts` fails if a plan-holding scene node stops
 * being reconciled.)
 */
function nodeHasResult(data: Record<string, unknown>): boolean {
  if (data.executionStatus === "completed") return true
  if (data.generatedVideoUrl || data.generatedImageUrl || data.generatedAudioUrl || data.sourceImageUrl) return true
  if (data.generatedJson) return true // video-analysis / video-audit: the scene breakdown IS the result
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
/**
 * Recover a completed 3D-scene authoring job onto its node after a reload.
 *
 * Three things make this different from the media branch below:
 *
 *  - **Idempotence is by revision, not by emptiness.** A revision already in
 *    `sceneHistory` was recovered (or arrived live) on an earlier pass; writing
 *    it again would park it a second time on every reload.
 *  - **A newer edit wins.** The completion goes through the SAME
 *    `resolveSceneCompletion` a live poll uses, comparing the node's current
 *    revision against the base the run was launched on. `sceneJobBaseRevisionId`
 *    survives the save (it is not a transient runtime key), so a run interrupted
 *    mid-flight still knows what it started from. When it does not, base
 *    `undefined` against an existing scene reads as superseded — the arriving
 *    plan is parked for the user, which is the right answer under uncertainty.
 *  - **Nothing is discarded.** Park or adopt, the revision lands in history.
 *
 * `executionStatus` is deliberately NOT set to `"completed"`: the value is the
 * scene itself, and the node paints from `scenePlan`.
 */
export function buildScene3DRecoveryPatch(
  data: Record<string, unknown>,
  output: Record<string, unknown> | null | undefined,
  source: "generate" | "edit" = "generate",
): Record<string, unknown> | null {
  const incoming = output?.scenePlan as Record<string, unknown> | undefined
  if (!incoming) return null

  const history = data.sceneHistory as Scene3DRevisionEntry[] | undefined
  const incomingRevision = planRevisionId(incoming)
  // Already recorded — this job was reconciled before, or its result arrived
  // live. Re-parking it every reload would be its own bug.
  if (incomingRevision && findRevision(history, incomingRevision)) return null

  const result = resolveSceneCompletion({
    current: data.scenePlan as Record<string, unknown> | undefined,
    baseRevisionId: data.sceneJobBaseRevisionId as string | undefined,
    incoming,
    changeSummary: typeof output?.changeSummary === "string" ? output.changeSummary : undefined,
    history,
    source,
  })
  return { ...result.patch }
}

export function buildCompletedResultPatch(
  nodeType: string | undefined,
  output: Record<string, unknown> | null | undefined,
  jobId: string,
  timestamp: string,
  /** The node's LIVE data. Only the Scene3D lane reads it (its guard compares
   *  the arriving revision against what the node holds now). */
  nodeData: Record<string, unknown> = {},
): Record<string, unknown> | null {
  if (!output) return null
  // 3D-scene authoring nodes: the result is a plan revision, not a URL. Routed
  // here so every recovery caller inherits the revision guard. `nodeData` is
  // what that guard reads — a caller that cannot supply it gets the
  // fresh-node answer (adopt), which is the right default for an empty node.
  if (isScene3DNodeType(nodeType)) return buildScene3DRecoveryPatch(nodeData, output, nodeType === "edit-3d-scene" ? "edit" : "generate")
  // The analysis emitters are the nodes whose result is a JSON payload
  // (`output_data.json` → `data.generatedJson`), not a media URL — without this
  // branch a completed analysis fell through every recovery layer and the node
  // stayed empty after any reload whose live poll died (billed, result in My
  // Library, nothing on canvas — reported 2026-08-03). Type-gated so a stray
  // `json` field on a media job can never shadow its real URL result.
  //
  // video-audit rides the same branch AND restores its fix-and-disclose report
  // (`output_data.report` → `data.lastAuditReport`) beside the corrected
  // analysis: the report strip is the node's primary reading surface, so
  // recovering only the JSON would render a completed audit half-blank.
  if (nodeType === "video-analysis" || nodeType === "video-audit") {
    if (!output.json || typeof output.json !== "object") return null
    const patch: Record<string, unknown> = { executionStatus: "completed", generatedJson: output.json }
    if (nodeType === "video-audit" && output.report && typeof output.report === "object") {
      patch.lastAuditReport = output.report
    }
    return patch
  }
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

  // CONTENT-POLICY DISCLOSURE passthrough (Task A4 follow-up, 2026-08-03) —
  // GVP-only, mirrors the video-analysis special case above: this function's
  // own motivating scenario is a long GVP run (10-40+ min) whose result lands
  // while the tab is closed, so a disclosed rewritten segment must still show
  // the notice after reload, not just on a live run (execute-node.ts's
  // gvpProExtractor already covers that path — see generate-video-pro-node.tsx).
  if (nodeType === "generate-video-pro" && Array.isArray(output.contentPolicyRewrites) && output.contentPolicyRewrites.length > 0) {
    patch.contentPolicyRewrites = output.contentPolicyRewrites
  }
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
  /** Live node data by id, re-read after each `fetchOutput` await. Omitted →
   *  the pre-fetch snapshot is used (the historical behaviour). */
  readLiveData?: (nodeId: string) => Record<string, unknown> | undefined,
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
    if (!job || job.status !== "completed" ) continue

    // Re-read the node AFTER the await. `nodes` is the snapshot taken before
    // the fetch, and a scene node is interactive the whole time this runs —
    // the user can nudge an object, restore a revision or clear the scene
    // while the job lookup is in flight. Deciding against the stale snapshot
    // would overwrite exactly the edit that was made during recovery.
    const live = readLiveData?.(nodeId) ?? data
    if (readLiveData && nodeHasResult(live)) continue

    const patch = buildCompletedResultPatch(node.type, job.output_data ?? null, jobId, nowIso, live)
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
    readLiveData?: (nodeId: string) => Record<string, unknown> | undefined
  },
): Promise<void> {
  try {
    const { data: items } = await deps.listCompleted(workflowId)
    const refs = pickLatestCompletedJobPerNode(items)
    if (refs.length === 0) return
    const fetchOutput =
      deps.fetchOutput ?? (async (jobId: string) => (await getJobStatusLean(jobId)) as { status: string; output_data?: Record<string, unknown> | null })
    const patches = await computeCompletedJobPatches(
      refs,
      nodes,
      fetchOutput,
      deps.nowIso ?? new Date().toISOString(),
      deps.readLiveData,
    )
    for (const p of patches) updateNodeData(p.nodeId, p.updates)
  } catch {
    console.warn("[reconcile-completed-jobs] reconcile skipped; long-job results may be missing until re-run")
  }
}
