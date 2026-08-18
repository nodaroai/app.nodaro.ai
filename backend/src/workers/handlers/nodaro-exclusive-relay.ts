/**
 * Run a Nodaro-EXCLUSIVE node on the connected cloud (4b, PR 3).
 *
 * The exclusive nodes (voice-changer-pro, generate-video-pro, edit-video-pro,
 * video-analysis, video-audit) are implemented by @nodaroai/cloud-plugins,
 * which never loads on a self-host — so unlike the vendor-direct relay
 * (cloud-video-relay.ts) there is no local implementation to fall back FROM:
 * the connection IS the implementation. A sibling of that relay rather than a
 * CLOUD_ROUTE_BY_JOB_TYPE entry because these jobs need what the one-shot
 * replay cannot give: the cloud job id persisted BEFORE polling (stall-retry
 * must resume, never re-create), stop forwarding, a continue variant, an
 * hour-plus poll budget, and per-type output adaptation (gvp/evp are video,
 * vcp is audio-or-video, video-analysis/audit are JSON).
 *
 * Billing happens on the CLOUD account (the credential's owner); locally
 * `cost` stays null and `providerUsed` is "nodaro".
 */

import type { Job } from "bullmq"
import {
  markJobCompleted,
  generateAndUploadThumbnail,
  setJobProgress,
  uploadVideoMaybeWatermark,
  type JobContext,
  type HandlerFn,
} from "../shared.js"
import { uploadToR2 } from "../../lib/storage.js"
import { runPostProcessing } from "../../lib/post-processing-error.js"
import { supabase } from "../../lib/supabase.js"
import { finalizeJobWithMedia } from "../../lib/job-finalize.js"
import {
  createCloudJob,
  waitForCloudJob,
  NodaroCloudError,
  type CloudJob,
} from "../../providers/nodaro/client.js"
import { nodaroCloudFetch } from "../../lib/nodaro-connect.js"
import { INSTANCE_ONLY_FIELDS, rehostIfUrlField } from "../../providers/nodaro/run-on-cloud.js"

/** Wire path per exclusive job type — mirrors the cloud plugin's routes. */
const EXCLUSIVE_ROUTE_BY_JOB_TYPE: Readonly<Record<string, string>> = {
  "voice-changer-pro": "/v1/voice-changer-pro",
  "generate-video-pro": "/v1/generate-video-pro",
  "edit-video-pro": "/v1/edit-video-pro",
  "video-analysis": "/v1/video-analysis",
  "video-audit": "/v1/video-audit",
}

/** Poll budgets per type. gvp/evp legitimately run an hour+; kept under the
 *  orchestrator's 90-min NODE_TIMEOUT_MS. The others are generous defaults. */
const POLL_BUDGET_BY_JOB_TYPE: Readonly<Record<string, number>> = {
  "generate-video-pro": 85 * 60 * 1000,
  "edit-video-pro": 85 * 60 * 1000,
  "voice-changer-pro": 30 * 60 * 1000,
  "video-analysis": 30 * 60 * 1000,
  "video-audit": 30 * 60 * 1000,
}

export function isNodaroExclusiveJobType(jobType: string): boolean {
  return jobType in EXCLUSIVE_ROUTE_BY_JOB_TYPE
}

/** Build the cloud request body from the enqueued payload: strip the
 *  instance-only bookkeeping and re-host URL-named media fields. */
async function buildCloudBody(payload: Record<string, unknown>): Promise<Record<string, unknown>> {
  const kept = Object.entries(payload).filter(
    ([key, value]) => !INSTANCE_ONLY_FIELDS.has(key) && !key.startsWith("__") && value !== undefined,
  )
  return Object.fromEntries(
    await Promise.all(kept.map(async ([key, value]) => [key, await rehostIfUrlField(key, value)])),
  )
}

/** Persist the CLOUD job id + kind before polling — the stall-retry contract:
 *  a re-picked BullMQ job resumes via inline reconcile instead of paying for
 *  a second cloud generation. */
async function persistCloudTask(jobId: string, cloudJobId: string): Promise<void> {
  const { error } = await supabase
    .from("jobs")
    .update({
      provider_kind: "nodaro-cloud",
      provider_task_id: cloudJobId,
      provider_call_started_at: new Date().toISOString(),
    })
    .eq("id", jobId)
  if (error) {
    // Persisting the task id is what makes death recoverable — better to
    // fail now (refund path) than to run unrecoverable.
    throw new Error(`Failed to persist cloud task id for ${jobId}: ${error.message}`)
  }
}

/** True when the local row carries a stop request (set by the /stop route
 *  before the cloud job existed). */
async function stopRequested(jobId: string): Promise<boolean> {
  const { data } = await supabase.from("jobs").select("stop_requested_at").eq("id", jobId).maybeSingle()
  return Boolean((data as { stop_requested_at?: string | null } | null)?.stop_requested_at)
}

/** Forward a pending stop to the cloud job (gvp only — the one stoppable type). */
export async function forwardStopToCloud(cloudJobId: string): Promise<void> {
  await nodaroCloudFetch(`/v1/generate-video-pro/${cloudJobId}/stop`, { method: "POST" })
}

/**
 * Adapt a FINISHED cloud job's output into this instance's storage + row.
 * Shared verbatim by the live relay and reconcileNodaroCloudJob so recovery
 * cannot drift from the primary path.
 */
export async function finalizeExclusiveCloudOutput(args: {
  jobId: string
  jobType: string
  cloudJob: CloudJob
  jobUserId: string | undefined
  shouldWatermark: boolean
}): Promise<boolean> {
  const { jobId, jobType, cloudJob, jobUserId, shouldWatermark } = args
  const output = (cloudJob.output_data ?? {}) as Record<string, unknown>

  // JSON producers: the analysis IS the result — no media to re-host.
  if (jobType === "video-analysis" || jobType === "video-audit") {
    return markJobCompleted(jobId, {
      output_data: { ...output, viaNodaroCloud: true },
      provider: "nodaro",
      ...(cloudJob.id ? { provider_task_id: cloudJob.id } : {}),
    })
  }

  const videoUrl = typeof output.videoUrl === "string" ? output.videoUrl : null
  const audioUrl = typeof output.audioUrl === "string" ? output.audioUrl : null

  if (videoUrl) {
    // gvp / evp / vcp-video-mode: bring the video home under this instance's
    // key, watermarked by THIS install's rules; carry the rest of the cloud
    // output verbatim — gvp's `pro` checkpoint is what stop/continue read.
    const r2Url = await uploadVideoMaybeWatermark(videoUrl, jobId, jobUserId, shouldWatermark)
    const thumbUrl = await generateAndUploadThumbnail(r2Url, jobId, jobUserId)
    const { videoUrl: _v, ...rest } = output
    if (jobType === "generate-video-pro" || jobType === "edit-video-pro") {
      const { ok } = await finalizeJobWithMedia({
        jobId,
        jobType: "text-to-video", // storage classification only: a video deliverable
        result: { url: videoUrl, cost: null, providerUsed: "nodaro" },
        mediaUrl: r2Url,
        extraOutputData: { thumbnailUrl: thumbUrl, ...rest, viaNodaroCloud: true },
      })
      return ok
    }
    return markJobCompleted(jobId, {
      output_data: { videoUrl: r2Url, thumbnailUrl: thumbUrl, ...rest, viaNodaroCloud: true },
      provider: "nodaro",
    })
  }

  if (audioUrl) {
    // vcp audio mode. POST-PROVIDER: the cloud already billed the delivery —
    // an R2 hiccup here must not refund.
    const r2Url = await runPostProcessing(() => uploadToR2(audioUrl, jobId, "audio", jobUserId))
    const { audioUrl: _a, ...rest } = output
    return markJobCompleted(jobId, {
      output_data: { audioUrl: r2Url, ...rest, viaNodaroCloud: true },
      provider: "nodaro",
    })
  }

  throw new NodaroCloudError(
    `nodaro.ai: ${jobType} finished on the connection but returned no media or analysis`,
  )
}

/** The worker handler shared by all five exclusive types. */
export function makeNodaroExclusiveHandler(jobType: string): HandlerFn {
  return async function handleNodaroExclusive(job: Job, ctx: JobContext): Promise<void> {
    const route = EXCLUSIVE_ROUTE_BY_JOB_TYPE[jobType]
    if (!route) throw new Error(`not a nodaro-exclusive job type: ${jobType}`)
    const payload = job.data as Record<string, unknown>
    console.log(`[worker] ${jobType} ${ctx.jobId}: relaying to the nodaro.ai connection`)

    // Continue (gvp): the payload carries the CLOUD parent id the route
    // resolved from the local fromJobId; the cloud's own /continue creates
    // the new cloud job.
    const cont = payload.__nodaroContinue as { cloudFromJobId: string; fromSegment?: number } | undefined
    const body = await buildCloudBody(payload)
    const cloudJobId = cont
      ? await createCloudJob("/v1/generate-video-pro/continue", {
          ...body,
          fromJobId: cont.cloudFromJobId,
          ...(cont.fromSegment !== undefined ? { fromSegment: cont.fromSegment } : {}),
        })
      : await createCloudJob(route, body)

    await persistCloudTask(ctx.jobId, cloudJobId)

    // A stop that arrived before the cloud job existed is forwarded now —
    // the /stop route could only stamp the local row at that point.
    if (jobType === "generate-video-pro" && (await stopRequested(ctx.jobId))) {
      await forwardStopToCloud(cloudJobId).catch((err) => {
        console.warn(`[worker] ${ctx.jobId}: could not forward pending stop:`, err instanceof Error ? err.message : err)
      })
    }

    await setJobProgress(job, ctx.jobId, 5)
    const cloudJob = await waitForCloudJob(
      cloudJobId,
      async (p) => {
        await setJobProgress(job, ctx.jobId, Math.min(95, Math.max(5, Math.round(p))))
      },
      { budgetMs: POLL_BUDGET_BY_JOB_TYPE[jobType] },
    )
    await setJobProgress(job, ctx.jobId, 97)
    const ok = await finalizeExclusiveCloudOutput({
      jobId: ctx.jobId,
      jobType,
      cloudJob,
      jobUserId: ctx.jobUserId,
      shouldWatermark: ctx.shouldWatermark,
    })
    if (!ok) return
    console.log(`[worker] Job ${ctx.jobId} completed via the nodaro.ai connection (${jobType})`)
  }
}

export const nodaroExclusiveRelayHandlers: Record<string, HandlerFn> = Object.fromEntries(
  Object.keys(EXCLUSIVE_ROUTE_BY_JOB_TYPE).map((t) => [t, makeNodaroExclusiveHandler(t)]),
)
