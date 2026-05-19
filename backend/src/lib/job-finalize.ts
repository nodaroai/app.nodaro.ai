import { supabase } from "./supabase.js"
import { uploadToR2 } from "./storage.js"
import {
  uploadImageVariantsMaybeWatermark,
  uploadVideoMaybeWatermark,
  buildImageOutputData,
  markJobCompleted,
  commitJobCredits,
  createAssetFromJob,
} from "../workers/shared.js"

/**
 * Provider-side input to `finalizeJobWithMedia`. Mirrors the relevant fields
 * of `ProviderResult` (`backend/src/providers/provider.interface.ts`) but
 * pared down to the keys this function actually reads.
 *
 * `extraUrls` carries additional image variants when the provider returned
 * multiple outputs (e.g., GPT-Image n=4). Audio/video providers return a
 * single `url`.
 */
export interface ProviderFinalizeResult {
  url: string
  extraUrls?: readonly string[]
  cost: number | null
  displayCost?: number | null
  providerUsed?: string | null
  kieTaskId?: string
  seed?: number
  fallbackFlag?: boolean
  providerMs?: number
}

/**
 * The set of job types this function knows how to finalize. Anything outside
 * this union throws — by design, since the dispatch table has to know whether
 * to upload as image / video / audio.
 */
export type FinalizeJobType =
  | "generate-image" | "image-to-image" | "edit-image"
  | "image-to-video" | "text-to-video" | "video-to-video"
  | "motion-transfer" | "video-upscale" | "lip-sync" | "extend-video"
  | "text-to-speech" | "text-to-audio" | "generate-music" | "voice-clone"
  | "audio-isolation" | "speech-to-text" | "generate-dialogue"

/**
 * Row shape we read from `jobs`. The orchestrator records the per-node owner
 * via `workflow_executions.node_states[nodeId].jobId` — there is no
 * `jobs.node_id` column on the schema today, so the reopen path looks up the
 * owning node from `node_states` instead of joining back via job columns.
 */
interface JobRow {
  id: string
  user_id: string | null
  should_watermark: boolean | null
  is_public: boolean | null
  job_type: string | null
  workflow_execution_id: string | null
  status: string
}

const IMAGE_TYPES: ReadonlySet<FinalizeJobType> = new Set<FinalizeJobType>([
  "generate-image", "image-to-image", "edit-image",
])

const VIDEO_TYPES: ReadonlySet<FinalizeJobType> = new Set<FinalizeJobType>([
  "image-to-video", "text-to-video", "video-to-video",
  "motion-transfer", "video-upscale", "lip-sync", "extend-video",
])

const AUDIO_TYPES: ReadonlySet<FinalizeJobType> = new Set<FinalizeJobType>([
  "text-to-speech", "text-to-audio", "generate-music", "voice-clone",
  "audio-isolation", "speech-to-text", "generate-dialogue",
])

/**
 * Look up the reserved usage_log id for a job. There is no `usage_log_id`
 ***REDACTED-OSS-SCRUB***
 * so we query `usage_logs` directly. Returns `null` when no reserved row exists
 * — `commitJobCredits` then no-ops gracefully.
 */
async function loadUsageLogId(jobId: string): Promise<string | null> {
  const { data } = await supabase
    .from("usage_logs")
    .select("id")
    .eq("job_id", jobId)
    .eq("status", "reserved")
    .limit(1)
  return (data?.[0] as { id: string } | undefined)?.id ?? null
}

/**
 * If a workflow_execution was marked `failed` solely because of this job's node,
 * flip it back to `completed`. Used when reconciliation recovers a single stuck
 * node — the rest of the DAG already completed successfully on the prior attempt.
 *
 * Source of truth is `workflow_executions.node_states` — a jsonb
 * `Record<nodeId, { status, jobId, error, ... }>` populated by the orchestrator
 * (see `orchestrator-worker.ts:306` for the shape). We identify our owning node
 * by `state.jobId === jobId`, then verify it's the only `failed` entry across
 * all node_states before reopening.
 *
 * CAS-guarded on `.eq("status", "failed")` so a user cancellation that landed
 * between the SELECT and the UPDATE is NOT overwritten.
 */
async function reopenWorkflowExecutionIfSoleCause(
  workflowExecutionId: string,
  jobId: string,
): Promise<void> {
  const { data: exec } = await supabase
    .from("workflow_executions")
    .select("status, node_states, completed_nodes")
    .eq("id", workflowExecutionId)
    .single()

  if (!exec || exec.status !== "failed") return

  const nodeStates = (exec.node_states ?? {}) as Record<
    string,
    { status?: string; jobId?: string }
  >

  // Find which node owns this job, and count failed nodes overall.
  let ourNodeId: string | null = null
  let failedCount = 0
  for (const [nodeId, state] of Object.entries(nodeStates)) {
    if (state.jobId === jobId) ourNodeId = nodeId
    if (state.status === "failed") failedCount++
  }

  // Only reopen when (a) we found our node, (b) it's the failed one, and
  // (c) no other node is currently failed.
  if (!ourNodeId) return
  if (nodeStates[ourNodeId]?.status !== "failed") return
  if (failedCount !== 1) return

  const updatedNodeStates = {
    ...nodeStates,
    [ourNodeId]: { ...nodeStates[ourNodeId], status: "completed" },
  }

  await supabase
    .from("workflow_executions")
    .update({
      status: "completed",
      node_states: updatedNodeStates,
      failed_nodes: 0,
      completed_nodes: ((exec.completed_nodes as number | null) ?? 0) + 1,
      error_message: null,
    })
    .eq("id", workflowExecutionId)
    .eq("status", "failed")  // CAS — preserve a user cancel that landed in this window
}

export interface FinalizeInput {
  jobId: string
  jobType: FinalizeJobType
  result: ProviderFinalizeResult
  /** Optional pre-uploaded R2 URL. When provided, finalize skips its own
   *  upload step and uses this URL directly. Used by video handlers that
   *  must upload before finalize (audio merge produces a local file the
   *  handler uploads + watermarks itself). Image and audio handlers + all
   *  reconcile paths leave this undefined and let finalize upload.
   *  For multi-variant outputs (image), pass the primary URL here and the
   *  variants via `extraMediaUrls`. */
  mediaUrl?: string
  /** Extra R2 URLs for multi-variant image outputs (used alongside
   *  `mediaUrl`). Ignored for video/audio. */
  extraMediaUrls?: readonly string[]
  /** Extra fields merged into `output_data` (e.g., `thumbnailUrl`,
   *  provider-meta extras). Useful for video handlers that need to record
   *  a thumbnail alongside the main URL. */
  extraOutputData?: Record<string, unknown>
}

/**
 * Post-success completion path shared by worker handlers and the reconciliation
 * cron. Uploads media → CAS-guarded markCompleted → commit credits → create
 * asset → reopen workflow_executions if this was the sole-cause failure.
 *
 * Idempotent under worker+cron race: only one writer wins the CAS UPDATE
 * inside `markJobCompleted`; the other returns `{ ok: false }`. R2 PutObject
 * is atomic per deterministic key, so the duplicate upload is harmless.
 *
 * Returns `{ ok: true }` only when the CAS UPDATE succeeded AND we committed
 * credits + created the asset. `{ ok: false }` covers four cases:
 *  - jobs row not found (callsite probably wrong)
 *  - jobs.status already terminal (cancelled / completed / failed)
 *  - markJobCompleted CAS missed (concurrent cancel won)
 *
 ***REDACTED-OSS-SCRUB***
 */
export async function finalizeJobWithMedia(
  input: FinalizeInput,
): Promise<{ ok: boolean }> {
  const { jobId, jobType, result } = input

  // 1. Load job row (the shape we need for upload / asset / reopen).
  const { data: jobRow } = await supabase
    .from("jobs")
    .select("id, user_id, should_watermark, is_public, job_type, workflow_execution_id, status")
    .eq("id", jobId)
    .single()
  const job = jobRow as JobRow | null
  if (!job) {
    console.warn(`[job-finalize] job ${jobId} not found`)
    return { ok: false }
  }
  if (job.status !== "pending" && job.status !== "processing") {
    // Already terminal — finalize is a no-op so we don't trample a prior
    // completion / cancellation. Caller should treat this as a successful
    // skip (the work was already done).
    return { ok: false }
  }

  const watermark = job.should_watermark ?? false

  // 2. Look up usage_log_id from usage_logs (NOT from a jobs.* column —
  //    that column doesn't exist; see D7 in the design spec §3).
  const usageLogId = await loadUsageLogId(jobId)

  // 3. Upload media — dispatch by jobType. Callers that have already uploaded
  //    (e.g., video handlers after audio-merge produces a local file) pass
  //    `input.mediaUrl` so we skip the upload and use it directly.
  let outputData: Record<string, unknown>
  if (IMAGE_TYPES.has(jobType)) {
    const r2Urls = input.mediaUrl !== undefined
      ? [input.mediaUrl, ...(input.extraMediaUrls ?? [])]
      : await uploadImageVariantsMaybeWatermark(
          [result.url, ...(result.extraUrls ?? [])],
          jobId,
          job.user_id ?? undefined,
          watermark,
        )
    outputData = buildImageOutputData(
      result as Parameters<typeof buildImageOutputData>[0],
      r2Urls,
    )
  } else if (VIDEO_TYPES.has(jobType)) {
    const r2Url = input.mediaUrl !== undefined
      ? input.mediaUrl
      : await uploadVideoMaybeWatermark(
          result.url,
          jobId,
          job.user_id ?? undefined,
          watermark,
        )
    outputData = { videoUrl: r2Url }
  } else if (AUDIO_TYPES.has(jobType)) {
    // Audio is never watermarked. Callers with a pre-uploaded R2 URL pass it
    // through `input.mediaUrl`; otherwise finalize uploads via `uploadToR2`.
    const r2Url = input.mediaUrl !== undefined
      ? input.mediaUrl
      : await uploadToR2(result.url, jobId, "audio", job.user_id ?? undefined)
    outputData = { audioUrl: r2Url }
  } else {
    throw new Error(`[job-finalize] unknown jobType: ${jobType}`)
  }

  if (input.extraOutputData) {
    outputData = { ...outputData, ...input.extraOutputData }
  }

  // 4. CAS-guarded markJobCompleted — refuses to overwrite a status='cancelled'
  //    row so a user cancel that beat us isn't trampled.
  const ok = await markJobCompleted(jobId, {
    output_data: outputData,
    provider: result.providerUsed,
    provider_cost: result.cost,
    display_cost: result.displayCost,
    ...(result.kieTaskId && { kie_task_id: result.kieTaskId }),
  })
  if (!ok) return { ok: false }

  // 5. Commit credits (idempotent: CAS on usage_logs.status='reserved' inside
  //    commitJobCredits; null usageLogId is a graceful no-op).
  await commitJobCredits(usageLogId, jobId, result.cost)

  // 6. Create asset record so the output appears in /library.
  await createAssetFromJob(jobId, job.user_id ?? undefined)

  // 7. Reopen workflow_execution if this was the sole-cause failure
  if (job.workflow_execution_id) {
    await reopenWorkflowExecutionIfSoleCause(job.workflow_execution_id, jobId)
  }

  return { ok: true }
}
