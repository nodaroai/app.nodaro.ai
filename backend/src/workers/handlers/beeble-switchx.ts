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

const POLL_INTERVAL_MS = 5000

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
    usageLogId?: string | null
  }

  console.log(`[worker] switchx ${ctx.jobId} (mode: ${alphaMode}, res: ${maxResolution ?? 1080})`)

  // Build the vendor request. Our R2 URLs are passed directly (Beeble fetches
  // them server-side); idempotency_key = our jobId dedupes a BullMQ stall-retry
  // on Beeble's side. Optional fields are omitted (not sent as undefined).
  const request: CreateSwitchXRequest = {
    generation_type: "video",
    source_uri: videoUrl,
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
  for (;;) {
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS))
    await throwIfJobCancelled()

    let status
    try {
      status = await getSwitchXStatus(beebleId)
    } catch (err) {
      await onBeebleProviderError(err)
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
    extraOutputData: { thumbnailUrl },
  })
  if (!ok) return
  console.log(`[worker] Job ${ctx.jobId} completed: ${r2Url} (provider: beeble)`)
}
