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
 * On load: list the workflow's recently-TERMINAL single-node jobs (each keyed
 * by canvas `node_id`), and for every node that has no result yet, fetch that
 * job's `output_data` and write its single result (`videoUrl` / `imageUrl` /
 * `audioUrl`). Guarded to never overwrite a node the user already has a result
 * on or has marked completed (mirrors `applyCompletedExecutionResults`), so it's
 * idempotent and multi-tab safe.
 *
 * Why FAILED jobs are listed too
 * ------------------------------
 * A run can refuse its result and still RETAIN what it produced. A 3D-scene
 * authoring run whose repair budget is spent and whose visual reviewer refuses
 * the scene settles `failed` — with a real, renderable revision in
 * `output_data`, billed and published. This lane used to ask for
 * `status: "completed"` only, so that draft was unreachable after a reload:
 * gone entirely when the refusal settled with the tab closed, and stripped of
 * its VERDICT even when it had arrived live (`executionStatus` is a transient
 * key — `errorMessage` survives the save, the failed status does not).
 *
 * The widening is deliberately NARROW: a failed job is a recovery candidate
 * only for a node type whose results are revisions (`isScene3DNodeType`). No
 * other node type retains anything on failure, and resurrecting a failure
 * banner for one would be a regression, not a fix.
 */

import { getJobStatusLean } from "./api"
import { COMPOSER_PLAN_MAP, unwrapEditPlanOutput } from "@nodaro/shared"
import { findRevision, resolveSceneCompletion } from "@/lib/scene3d/revisions"
import { planRevisionId } from "@/lib/scene3d/plan-view"
import { isScrapeNodeType, scrapeJobNeedsApplying, scrapeResultPatch } from "@/components/nodes/scrape-result-recovery"
import { settledBeforeClear } from "@/lib/results-cleared"
import { videoOverlayRunOutputFields } from "@/lib/video-overlay-run-output"
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
  readonly createdAt?: string
  readonly completedAt?: string
}

/** A terminal job a node may be recovered from. */
export interface TerminalJobRef {
  readonly nodeId: string
  readonly jobId: string
  readonly status: "completed" | "failed"
  /** When the server created the job. The scrape lane ties a job to the node's
   *  last run with it (`scrapeJobNeedsApplying`). */
  readonly createdAt?: string
  /** When the job settled (falls back to `createdAt`). Compared with the stamp
   *  "Clear results" leaves on a node — see `blocksRecovery`. */
  readonly settledAt?: string
}

export interface NodeResultUpdate {
  readonly nodeId: string
  readonly updates: Record<string, unknown>
}

/**
 * Pick the latest TERMINAL single-node job PER node from a
 * `listWorkflowExecutions(status:"completed,failed")` response. Items arrive
 * newest-first, so the first ELIGIBLE occurrence of each node_id is the run
 * this node should reflect. Skips items with no canvas node_id (SDK/legacy
 * rows) and non-single-node items (orchestrator executions carry their own
 * results in node_states).
 *
 * EXACTLY ONE ref per node, and that is a correctness constraint rather than
 * tidiness: `computeCompletedJobPatches` builds every patch against the SAME
 * pre-patch snapshot, so two patches for one node would clobber each other's
 * `sceneHistory` — the second would drop the first's revision.
 *
 * `acceptsFailed` decides, per node, whether a FAILED run is eligible at all.
 * Without it a media node whose newest run failed would have that failure
 * SHADOW the older completed run this module exists to recover: the node would
 * claim its newest job, find no media on it, and stay empty. Only node types
 * that retain a result on failure say yes.
 */
export function pickLatestTerminalJobPerNode(
  items: readonly ExecItemLike[],
  opts: { acceptsFailed?: (nodeId: string) => boolean } = {},
): TerminalJobRef[] {
  const byNode = new Map<string, TerminalJobRef>()
  for (const item of items) {
    if (item.triggerType !== "single-node") continue
    const st = Object.values(item.nodeStates ?? {})[0] as SoleNodeState | undefined
    const nodeId = st?.nodeId
    if (!nodeId || byNode.has(nodeId)) continue
    const status = st?.status
    if (status !== "completed" && status !== "failed") continue
    if (status === "failed" && !opts.acceptsFailed?.(nodeId)) continue
    byNode.set(nodeId, {
      nodeId,
      jobId: st?.jobId ?? item.id,
      status,
      createdAt: item.createdAt,
      settledAt: item.completedAt ?? item.createdAt,
    })
  }
  return [...byNode.values()]
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
 *
 * Excluding `scenePlan` is not enough on its own: 3D Render Pro settles a scene
 * AND an MP4, so its own PREVIOUS video (`generatedVideoUrl` /
 * `generatedResults`) trips every other clause here and would skip the node for
 * the same reason. See `blocksRecovery`.
 */
function nodeHasResult(data: Record<string, unknown>): boolean {
  if (data.executionStatus === "completed") return true
  if (data.generatedVideoUrl || data.generatedImageUrl || data.generatedAudioUrl || data.sourceImageUrl) return true
  if (data.generatedJson) return true // video-analysis / video-audit: the scene breakdown IS the result
  const gr = data.generatedResults as readonly GeneratedResult[] | undefined
  return Array.isArray(gr) && gr.length > 0
}

/**
 * Whether what the node already holds should stop recovery.
 *
 * Ordinary media nodes: yes — a node with a result is a node the user may have
 * curated, and re-writing it is the clobber this guard exists to prevent.
 *
 * Scene3D nodes: NO, and the exemption is per-TYPE rather than a weakening of
 * `nodeHasResult` (which every other lane still uses verbatim). Their recovery
 * is guarded by REVISION, not by emptiness: `buildScene3DRecoveryPatch` drops a
 * revision already in `sceneHistory` and routes the rest through
 * `resolveSceneCompletion`, which parks rather than overwrites when the node
 * has moved on. That is strictly stronger than "has any result", and it is the
 * only guard that can recover the case this whole module exists for on a node
 * that has run BEFORE: run again → reload mid-run → the job settles in the
 * background. Blocking on the previous MP4 there loses the paid revision as
 * well as the new video — billed, in My Library, nothing on canvas.
 */
function blocksRecovery(
  nodeType: string | undefined,
  data: Record<string, unknown>,
  ref: Pick<TerminalJobRef, "jobId" | "createdAt" | "settledAt">,
): boolean {
  // Emptied on purpose, AFTER this job settled ("Clear results"). First, and
  // for every node type: the per-type guards below all answer "may this job's
  // result be written?", and for a job the user has already cleared away the
  // answer is no before any of them is asked.
  if (settledBeforeClear(data, ref.settledAt)) return true
  if (isScene3DNodeType(nodeType)) return false
  // Scrapers, for the same reason as Scene3D and with their own guard: a scrape
  // node KEEPS its last good payload through a failed or empty rerun (#765), so
  // "holds a result" is the normal state of one that has run before. Blocking
  // on it loses exactly the run this module exists for — rerun, cut off at the
  // edge or the tab closed mid-crawl, job finishes anyway. Their guard is by
  // JOB, not by emptiness.
  if (isScrapeNodeType(nodeType)) return !scrapeJobNeedsApplying(data, { id: ref.jobId, createdAt: ref.createdAt })
  return nodeHasResult(data)
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
  jobId?: string,
  /** ISO stamp for the media half's `GeneratedResult`. Injected so recovery is
   *  deterministic in tests, exactly like the media lane's `nowIso`. */
  timestamp?: string,
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
    // The run that produced it, recorded on the revision so a later
    // `{kind:'scene'}` source can name both.
    jobId,
  })
  // 3D Render Pro settles ONE job with two halves. Recovering only the scene
  // would leave a paid run showing its composition and no video after a reload
  // whose live poll died — the same "billed, result in My Library, nothing on
  // canvas" shape the analysis branch below exists to fix.
  //
  // Adopt-only, deliberately: when the arriving revision is PARKED (the user
  // edited the scene after this run started) its video belongs to the older
  // revision, and overwriting the live media would be the same mistake the
  // plan guard is here to prevent. The live path applies the same rule.
  const videoUrl = typeof output?.videoUrl === "string" ? output.videoUrl : undefined
  if (!videoUrl || result.outcome === "park") return { ...result.patch }

  // The media half is written the way the LIVE run writes it, not as a bare
  // URL: a `generatedResults` entry with real provenance (`timestamp`,
  // `jobId`) plus the index that selects it. Writing only `generatedVideoUrl`
  // left the node with no result row after a reload — no thumbnail strip, no
  // delete, no library correlation — i.e. behaving differently depending on
  // whether the poll survived, which is the drift this module exists to end.
  //
  // APPENDED, never replacing: earlier renders on this node are finished work
  // (each was billed and each is in My Library), so a recovery adds the run
  // that settled while the tab was closed and points the node at it.
  const previous = Array.isArray(data.generatedResults)
    ? (data.generatedResults as GeneratedResult[])
    : []
  // Same job already recorded (a live poll wrote it, or an earlier pass did):
  // select it instead of appending a second row for one render. The revision
  // guard above catches the ordinary repeat; this covers a node whose media
  // arrived without its revision.
  const alreadyAt = jobId ? previous.findIndex((r) => r.jobId === jobId) : -1
  const recovered: GeneratedResult = {
    url: videoUrl,
    timestamp: timestamp ?? new Date().toISOString(),
    jobId: jobId ?? "",
  }
  return {
    ...result.patch,
    generatedVideoUrl: videoUrl,
    generatedResults: alreadyAt >= 0 ? previous : [...previous, recovered],
    activeResultIndex: alreadyAt >= 0 ? alreadyAt : previous.length,
  }
}

/**
 * Recover a REFUSED 3D-scene authoring job onto its node after a reload.
 *
 * Two halves, and they are independent — which is the whole reason this is not
 * just `buildScene3DRecoveryPatch` with a different status:
 *
 *  - **The draft.** Only when this revision is not already recorded. Routed
 *    through the same `resolveSceneCompletion` guard a completed one is, so a
 *    manual edit made while the run was in flight still wins and the draft is
 *    parked into history rather than overwriting it. The MEDIA half is never
 *    applied: a refused run has no MP4 (the live lane and the DAG lane follow
 *    the same rule).
 *  - **The verdict.** Re-asserted on EVERY reload, including one where the
 *    draft is already in `sceneHistory` — because `executionStatus` is a
 *    TRANSIENT runtime key (`@nodaro/shared :: TRANSIENT_RUNTIME_KEYS`) and is
 *    stripped from the save payload. A refusal that reached the canvas live
 *    therefore came back after a reload as a scene with no failure on it,
 *    reading as a clean success for a run the reviewer rejected. `errorMessage`
 *    is persisted, so it is written only when it actually differs — otherwise a
 *    pure-transient patch keeps the load from phantom-dirtying the workflow.
 *
 * Returns null when the job retained nothing: a plain failure leaves the node
 * exactly as it was.
 */
export function buildScene3DRetainedDraftPatch(
  data: Record<string, unknown>,
  output: Record<string, unknown> | null | undefined,
  source: "generate" | "edit",
  jobId: string,
  errorMessage?: string | null,
): Record<string, unknown> | null {
  if (!output?.scenePlan) return null
  // Plan half — null when this revision was already filed (live, or an earlier
  // reload). The verdict below still applies.
  //
  // `videoUrl` is stripped rather than trusted absent: a refused run publishes
  // no MP4, and `buildScene3DRecoveryPatch` would happily write one (plus a
  // `generatedResults` row) if a producer ever put a stale URL on the failed
  // row. The node would then show a video for a run that failed and feed it
  // downstream from the `video` handle.
  const planOnly = { ...output, videoUrl: undefined }
  const draft = buildScene3DRecoveryPatch(data, planOnly, source, jobId)
  const patch: Record<string, unknown> = { ...(draft ?? {}), executionStatus: "failed" }
  const message = typeof errorMessage === "string" && errorMessage ? errorMessage : undefined
  if (message && data.errorMessage !== message) patch.errorMessage = message
  return patch
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
  if (isScene3DNodeType(nodeType)) return buildScene3DRecoveryPatch(nodeData, output, nodeType === "edit-3d-scene" ? "edit" : "generate", jobId, timestamp)
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
  // Scrapers: the result is `output_data.json` too, written through the live
  // run's own patch so the card, the counts and the kept-last-good contract are
  // identical however the result arrived.
  if (nodeType && isScrapeNodeType(nodeType)) return scrapeResultPatch(nodeType, output.json, jobId)
  // audio-sync: its offsets are `output_data.json` → `data.generatedJson`, not a
  // media URL (type-gated like the analysis branch above).
  if (nodeType === "audio-sync") {
    if (!output.json || typeof output.json !== "object") return null
    return { executionStatus: "completed", generatedJson: output.json }
  }
  // edit-plan: the EDL plan is the top-level output_data (an Edl for tighten, an
  // EdlClipSet for clips, a { version, chapters } for chapters) + viaNodaroCloud.
  // Unwrap it onto generatedJson (clips → bare Edl[], which fans out) — the ONE
  // rule shared with the live path + backend (unwrapEditPlanOutput). Same
  // recovery gap as the analysis branch above: no media URL, so it would
  // otherwise fall through and leave a completed node blank.
  if (nodeType === "edit-plan") {
    const plan = unwrapEditPlanOutput(output)
    if (plan === undefined || plan === null || typeof plan !== "object") return null
    return { executionStatus: "completed", generatedJson: plan }
  }
  const videoUrl = typeof output.videoUrl === "string" ? output.videoUrl : undefined
  const imageUrl = typeof output.imageUrl === "string" ? output.imageUrl : undefined
  const audioUrl = typeof output.audioUrl === "string" ? output.audioUrl : undefined
  const url = videoUrl ?? imageUrl ?? audioUrl
  if (!url) return null

  const thumbnailUrl = typeof output.thumbnailUrl === "string" ? output.thumbnailUrl : undefined
  // Video Overlay: the worker's warnings / canvas / length, on the node and the
  // result — the same mapping every other lane writes (lib/video-overlay-run-output).
  const overlayRun = nodeType === "video-overlay" ? videoOverlayRunOutputFields(output) : undefined
  const result: GeneratedResult = { url, thumbnailUrl, timestamp, jobId, ...(overlayRun ?? {}) }

  const patch: Record<string, unknown> = {
    executionStatus: "completed",
    generatedResults: [result],
    activeResultIndex: 0,
    ...(overlayRun ?? {}),
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
  refs: readonly TerminalJobRef[],
  nodes: readonly WorkflowNode[],
  fetchOutput: (jobId: string) => Promise<{
    status: string
    output_data?: Record<string, unknown> | null
    error_message?: string | null
  } | null>,
  nowIso: string,
  /** Live node data by id, re-read after each `fetchOutput` await. Omitted →
   *  the pre-fetch snapshot is used (the historical behaviour). */
  readLiveData?: (nodeId: string) => Record<string, unknown> | undefined,
): Promise<NodeResultUpdate[]> {
  const nodeById = new Map(nodes.map((n) => [n.id, n]))
  const out: NodeResultUpdate[] = []
  for (const ref of refs) {
    const { nodeId, jobId, status } = ref
    const node = nodeById.get(nodeId)
    if (!node) continue // deleted / sub-workflow node
    const data = (node.data ?? {}) as Record<string, unknown>
    if (blocksRecovery(node.type, data, ref)) continue // respect existing result / user edits

    let job: Awaited<ReturnType<typeof fetchOutput>>
    try {
      job = await fetchOutput(jobId)
    } catch {
      continue // best-effort — a lookup hiccup shouldn't block load
    }
    // The job must still be in the state the listing claimed — a run that has
    // moved on since the page loaded is not this pass's business.
    if (!job || job.status !== status) continue

    // Re-read the node AFTER the await. `nodes` is the snapshot taken before
    // the fetch, and a scene node is interactive the whole time this runs —
    // the user can nudge an object, restore a revision or clear the scene
    // while the job lookup is in flight. Deciding against the stale snapshot
    // would overwrite exactly the edit that was made during recovery.
    const live = readLiveData?.(nodeId) ?? data
    if (readLiveData && blocksRecovery(node.type, live, ref)) continue

    if (status === "failed") {
      // A refused run that RETAINED its draft. Scene3D only (the picker's
      // `acceptsFailed` is the gate; this re-checks so a hand-built ref can't
      // paint a failure onto a node type that never retains one).
      if (!isScene3DNodeType(node.type)) continue
      // The user hit Run again between load and here — never stamp a stale
      // verdict over a live one.
      const liveStatus = live.executionStatus
      if (liveStatus === "running" || liveStatus === "pending") continue
      const patch = buildScene3DRetainedDraftPatch(
        live,
        job.output_data ?? null,
        node.type === "edit-3d-scene" ? "edit" : "generate",
        jobId,
        job.error_message,
      )
      if (patch) out.push({ nodeId, updates: patch })
      continue
    }

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
    fetchOutput?: (jobId: string) => Promise<{
      status: string
      output_data?: Record<string, unknown> | null
      error_message?: string | null
    }>
    nowIso?: string
    readLiveData?: (nodeId: string) => Record<string, unknown> | undefined
  },
): Promise<void> {
  try {
    const { data: items } = await deps.listCompleted(workflowId)
    // A FAILED run is a recovery candidate only where a refusal can retain a
    // result — the scene-authoring nodes. Read off the CANVAS, so an unknown
    // node id (deleted, sub-workflow) simply says no.
    const typeById = new Map(nodes.map((n) => [n.id, n.type]))
    const refs = pickLatestTerminalJobPerNode(items, {
      // Scene3D: a refusal can retain a result. Scrapers: a failed job carries
      // nothing to paint (the loop below skips it) but it must still SHADOW an
      // older completed one — otherwise a genuinely failed rerun is "recovered"
      // from the run before it, and the failure disappears behind stale data.
      acceptsFailed: (nodeId) => isScene3DNodeType(typeById.get(nodeId)) || isScrapeNodeType(typeById.get(nodeId)),
    })
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
