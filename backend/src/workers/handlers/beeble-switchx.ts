/**
 * Worker handler for the `switchx` job type (Beeble SwitchX relight/composite).
 *
 * Submits the generation to Beeble's direct API (semaphore-bounded so concurrent
 * SwitchX jobs across the shared video worker never exceed Beeble's GLOBAL
 * 10-concurrent account cap), persists the provider task id immediately for
 * stall-retry dedup + reconciliation, polls to completion, then re-hosts the
 * expiring render URL to R2 (with watermark + browser-safe transcode) and
 * finalizes. Beeble returns no per-job meter, so the job commits the reserved
 * frame-tier bucket verbatim (`meteredCost: false`, `cost: null`).
 *
 * Modeled on handleAiAvatar (heygen-avatar.ts) — same uploadVideoMaybeWatermark
 * + finalizeJobWithMedia shape — but SwitchX polls explicitly (HeyGen's provider
 * call self-polls) and is bucket-billed rather than metered.
 */

import {
  startSwitchXGeneration,
  getSwitchXStatus,
  BeebleError,
  type CreateSwitchXRequest,
} from "../../providers/beeble/index.js"
import { withSwitchXSlot } from "../../lib/switchx-concurrency.js"
import { throwIfJobCancelled } from "../../lib/job-cancellation.js"
import { makeOnTaskCreated } from "../../lib/reconcile/persistence.js"
import {
  uploadVideoMaybeWatermark,
  generateAndUploadThumbnail,
  setJobProgress,
  type HandlerFn,
} from "../shared.js"
import { finalizeJobWithMedia } from "../../lib/job-finalize.js"
import { downloadFile, capVideoToFrames, createWorkDir, cleanupWorkDir } from "../../providers/video/ffmpeg-utils.js"
import { uploadFileWithKeyToR2 } from "../../lib/storage.js"
import { join } from "node:path"

const POLL_INTERVAL_MS = 5000
/** Max consecutive rate-limit 429s tolerated WHILE POLLING before giving up (the
 *  `beeble` reconciler then sweeps the still-running job). At ~5s/poll this rides
 *  out a multi-minute rate-limit window without failing a near-complete job. */
const MAX_POLL_RATE_LIMIT_STRIKES = 20

/** OUR shared Beeble account is out of funds / over its spending cap — every
 *  SwitchX job 402s until resolved. Surface loudly for the operator. */
const OPERATOR_BILLING_CODES = new Set([
  "INSUFFICIENT_BALANCE",
  "HARD_LIMIT_EXCEEDED",
  "BILLING_NOT_CONFIGURED",
])
/** Beeble's GLOBAL 10-concurrent / 5-RPM caps (shared across all our users). */
const RATE_LIMIT_CODES = new Set(["RATE_LIMIT_EXCEEDED", "CONCURRENT_LIMIT_EXCEEDED"])

/**
 * Side-effects for a provider error before the caller rethrows (so BullMQ
 * retries): an operator alert on a billing block, a jittered delay on a rate/
 * concurrency cap so the queue's fixed backoff doesn't resubmit the whole herd
 * in lockstep. No-op for anything that isn't a BeebleError.
 */
async function onBeebleProviderError(err: unknown): Promise<void> {
  if (!(err instanceof BeebleError)) return
  if (OPERATOR_BILLING_CODES.has(err.code)) {
    console.error(
      `[worker][switchx] BEEBLE ACCOUNT BILLING BLOCK (${err.code}): ${err.message} — top up / raise the spending limit on the shared Beeble account.`,
    )
    return
  }
  if (RATE_LIMIT_CODES.has(err.code)) {
    const jitterMs = 250 + Math.floor(Math.random() * 1500)
    await new Promise((resolve) => setTimeout(resolve, jitterMs))
  }
}

/**
 * Trim a source video down to `maxFrames` (Beeble's 240 cap) before submitting.
 * The route preflight flags this ONLY for a small overage (a clip ≤270 frames,
 * a hair over the cap) so it "just works" instead of erroring; larger clips are
 * rejected at the route. Re-hosts the trimmed clip under a DISTINCT R2 key (not
 * the jobId result key, which the final render owns) and returns its URL.
 */
async function trimSwitchXSource(
  videoUrl: string,
  maxFrames: number,
  jobId: string,
  userId?: string | null,
): Promise<string> {
  const workDir = await createWorkDir("switchx-trim")
  try {
    const inputPath = join(workDir, "input.mp4")
    const outputPath = join(workDir, "trimmed.mp4")
    await downloadFile(videoUrl, inputPath)
    await capVideoToFrames(inputPath, outputPath, maxFrames)
    return await uploadFileWithKeyToR2(
      outputPath,
      `videos/${jobId}-switchx-src.mp4`,
      "video/mp4",
      userId ?? undefined,
    )
  } finally {
    await cleanupWorkDir(workDir)
  }
}

export const handleBeebleSwitchX: HandlerFn = async function handleBeebleSwitchX(job, ctx) {
  const {
    videoUrl,
    referenceImageUrl,
    prompt,
    alphaMode,
    maskUrl,
    alphaKeyframeIndex,
    maxResolution,
    seed,
    trimSourceToFrames,
  } = job.data as {
    jobId: string
    videoUrl: string
    referenceImageUrl?: string
    prompt?: string
    alphaMode: CreateSwitchXRequest["alpha_mode"]
    maskUrl?: string
    alphaKeyframeIndex?: number
    maxResolution?: 720 | 1080
    seed?: number
    trimSourceToFrames?: number
    usageLogId?: string | null
  }

  console.log(`[worker] switchx ${ctx.jobId} (mode: ${alphaMode}, res: ${maxResolution ?? 1080})`)

  // A source a hair over Beeble's 240-frame cap is trimmed to fit (flagged by the
  // route preflight for a ≤270-frame clip) so it "just works" instead of erroring.
  // The trimmed clip is re-hosted and used as the source; the bill is the reserved
  // 240-frame tier. Larger clips were already rejected at the route.
  let sourceUri = videoUrl
  if (typeof trimSourceToFrames === "number" && trimSourceToFrames > 0) {
    console.log(`[worker] switchx ${ctx.jobId}: source over cap — trimming to ${trimSourceToFrames} frames`)
    sourceUri = await trimSwitchXSource(videoUrl, trimSourceToFrames, ctx.jobId, ctx.jobUserId)
  }

  // Build the vendor request. Our R2 URLs are passed directly (Beeble fetches
  // them server-side); idempotency_key = our jobId dedupes a BullMQ stall-retry
  // on Beeble's side. Optional fields are omitted (not sent as undefined).
  const request: CreateSwitchXRequest = {
    generation_type: "video",
    source_uri: sourceUri,
    alpha_mode: alphaMode,
    max_resolution: maxResolution ?? 1080,
    idempotency_key: ctx.jobId,
    ...(prompt ? { prompt } : {}),
    ...(referenceImageUrl ? { reference_image_uri: referenceImageUrl } : {}),
    ...(maskUrl ? { alpha_uri: maskUrl } : {}),
    ...(alphaKeyframeIndex !== undefined ? { alpha_keyframe_index: alphaKeyframeIndex } : {}),
    ...(seed !== undefined ? { seed } : {}),
  }

  // Submit, bounded by the semaphore so we stay under Beeble's global cap.
  let beebleId: string
  try {
    const submitted = await withSwitchXSlot(() => startSwitchXGeneration(request))
    beebleId = submitted.id
  } catch (err) {
    await onBeebleProviderError(err)
    throw err
  }

  // Persist the provider task id BEFORE polling: a BullMQ stall-retry resumes
  // against the same Beeble job (no double-submit / double-bill), and the
  // `beeble` reconciler kind can sweep a stalled job.
  await makeOnTaskCreated(ctx.jobId, "beeble")(beebleId)
  await setJobProgress(job, ctx.jobId, 5)

  // Poll to completion. throwIfJobCancelled() (active inside the worker's
  // runWithJobCancellation context) aborts promptly on user cancel — freeing the
  // worker slot and skipping the wasted R2 re-host. The Beeble-side job keeps
  // running (no cancel endpoint); that cost falls on the shared account.
  let renderUrl: string
  let rateLimitStrikes = 0
  for (;;) {
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS))
    await throwIfJobCancelled()

    let status
    try {
      status = await getSwitchXStatus(beebleId)
      rateLimitStrikes = 0
    } catch (err) {
      // A transient rate/concurrency 429 while polling must NOT fail the job —
      // the Beeble generation is still running. Back off (onBeebleProviderError
      // jitters) and retry the poll IN PLACE; give up only after many strikes.
      await onBeebleProviderError(err)
      if (err instanceof BeebleError && RATE_LIMIT_CODES.has(err.code) && ++rateLimitStrikes <= MAX_POLL_RATE_LIMIT_STRIKES) {
        continue
      }
      throw err
    }

    if (typeof status.progress === "number") {
      // Map Beeble's 0-100 into a 5-95 band; 100 is set after re-host.
      await setJobProgress(job, ctx.jobId, Math.min(95, Math.max(5, status.progress)))
    }
    if (status.status === "completed") {
      const url = status.output?.render
      if (!url) throw new Error("SwitchX completed without a render URL")
      renderUrl = url
      break
    }
    if (status.status === "failed") {
      throw new Error(status.error ?? "SwitchX generation failed")
    }
  }

  // Re-host immediately (Beeble URLs expire after 72h) WITH watermark (free tier)
  // + browser-safe transcode (Beeble may deliver HEVC). Only the R2 url is
  // persisted — the vendor render/source/alpha URLs are never stored.
  const r2Url = await uploadVideoMaybeWatermark(renderUrl, ctx.jobId, ctx.jobUserId, ctx.shouldWatermark)
  await setJobProgress(job, ctx.jobId, 100)
  const thumbnailUrl = await generateAndUploadThumbnail(r2Url, ctx.jobId, ctx.jobUserId)

  // No per-job meter from Beeble → commit the reserved frame-tier bucket verbatim
  // (cost:null + meteredCost:false; commitJobCredits charges the reserved hold).
  const { ok } = await finalizeJobWithMedia({
    jobId: ctx.jobId,
    jobType: "switchx",
    result: { url: r2Url, cost: null, meteredCost: false, providerUsed: "beeble" },
    mediaUrl: r2Url,
    extraOutputData: { thumbnailUrl, ...(trimSourceToFrames ? { sourceTrimmedToFrames: trimSourceToFrames } : {}) },
  })
  if (!ok) return
  console.log(`[worker] Job ${ctx.jobId} completed: ${r2Url} (provider: beeble)`)
}
