/**
 * Run a vendor-direct VIDEO job on the nodaro.ai connection and land the
 * result exactly where a local run would.
 *
 * HeyGen (ai-avatar, cinematic-avatar) and Beeble (switchx) are called from
 * their handlers, not through the capability router, so a keyless install
 * cannot fall through to the cloud provider the way image/video generation
 * does. This is that fallthrough for them: replay the job's own payload on
 * the cloud's identical route (providers/nodaro/run-on-cloud.ts), take the
 * finished cloud video, re-host it into THIS instance's storage (with this
 * instance's watermark decision), thumbnail it, and finalize the local job —
 * so downstream (gallery, node result, cleanup) cannot tell it from a local
 * run. Only used when the install has no key for that vendor and is
 * connected; the caller decides via shouldRunOnCloud().
 *
 * Community has no credit system, so `cost` is null and `providerUsed` is
 * "nodaro" — the connected account was billed on the cloud side.
 */

import type { Job } from "bullmq"
import {
  withProgressRamp,
  uploadVideoMaybeWatermark,
  generateAndUploadThumbnail,
  setJobProgress,
  type JobContext,
} from "../shared.js"
import { finalizeJobWithMedia, type FinalizeJobType } from "../../lib/job-finalize.js"

export type CloudRelayJobType = Extract<FinalizeJobType, "ai-avatar" | "cinematic-avatar" | "switchx">

/** Fields of the cloud job's output_data that are worth carrying over. */
const CARRIED_OUTPUT_FIELDS = ["durationSec", "warningMessage", "frameCount", "fps", "width", "height"] as const

export async function relayVideoJobToCloud(job: Job, ctx: JobContext, jobType: CloudRelayJobType): Promise<void> {
  console.log(`[worker] ${jobType} ${ctx.jobId}: no local vendor key — running on the nodaro.ai connection`)
  const { runJobOnCloud } = await import("../../providers/nodaro/run-on-cloud.js")

  const output = await withProgressRamp(job, ctx.jobId, { start: 5, cap: 45 }, () =>
    runJobOnCloud(jobType, job.data as Record<string, unknown>, (p) =>
      setJobProgress(job, ctx.jobId, Math.min(45, Math.round(5 + p * 0.4))),
    ),
  )
  const cloudUrl = typeof output.videoUrl === "string" ? output.videoUrl : null
  if (!cloudUrl) {
    throw new Error(`nodaro.ai: ${jobType} finished on the connection but returned no video`)
  }
  await setJobProgress(job, ctx.jobId, 50)

  // The cloud's URL is the cloud's storage — bring the file home under this
  // instance's own key, watermarked by THIS instance's rules.
  const r2Url = await uploadVideoMaybeWatermark(cloudUrl, ctx.jobId, ctx.jobUserId, ctx.shouldWatermark)
  await setJobProgress(job, ctx.jobId, 100)
  const thumbUrl = await generateAndUploadThumbnail(r2Url, ctx.jobId, ctx.jobUserId)

  const carried: Record<string, unknown> = {}
  for (const key of CARRIED_OUTPUT_FIELDS) {
    if (output[key] !== undefined && output[key] !== null) carried[key] = output[key]
  }

  const { ok } = await finalizeJobWithMedia({
    jobId: ctx.jobId,
    jobType,
    result: { url: cloudUrl, cost: null, providerUsed: "nodaro" },
    mediaUrl: r2Url,
    extraOutputData: { thumbnailUrl: thumbUrl, ...carried, viaNodaroCloud: true },
  })
  if (!ok) return
  console.log(`[worker] Job ${ctx.jobId} completed: ${r2Url} (provider: nodaro connection, ${jobType})`)
}
