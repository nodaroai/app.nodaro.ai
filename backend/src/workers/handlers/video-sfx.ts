/**
 * Video SFX worker handler — replicate-mmaudio (zsxkib/mmaudio).
 *
 * Takes a silent (or audio-bearing) input video and a text prompt describing
 * the sound to generate, calls Replicate's MMAudio model, and uploads the
 * returned mp4 (video + synthesized SFX audio merged) to R2.
 *
 * Reconcile contract: writes `provider_kind = "replicate-prediction"` +
 * `provider_call_started_at` BEFORE invoking Replicate so the reconcile cron
 * (20-min STALE_THRESHOLD_MS) can recover a stuck job. The provider client
 * fires `onTaskCreated(prediction.id)` between `predictions.create` and
 * `replicate.wait` to persist `provider_task_id` for cron lookup. If the
 * worker crashes BEFORE the create call, the worker's pre-task sentinel
 * (`provider_kind = "pre-task"`, set in video-worker.ts:148) takes over at
 * the 30-min sync-sweep threshold.
 *
 * Single-version-per-row contract: the route inserts ONE jobs row per
 * version in a multi-version batch (versions=1..4). Each BullMQ task here
 * processes a single row — no per-handler fan-out.
 */

import { supabase } from "../../lib/supabase.js"
import { generateVideoSfx } from "../../providers/replicate/sfx.js"
import { makeOnTaskCreated } from "../../lib/reconcile/persistence.js"
import {
  buildProviderMeta,
  generateAndUploadThumbnail,
  setJobProgress,
  uploadVideoMaybeWatermark,
  withProgressRamp,
  type HandlerFn,
} from "../shared.js"
import { finalizeJobWithMedia } from "../../lib/job-finalize.js"

/**
 * Shape of `jobs.input_data` written by the route at
 * `backend/src/routes/video-sfx.ts:180-192`. This is the single source of
 * truth for the per-job inputs — the BullMQ payload mirrors a subset of
 * these for parity, but we always re-read from the DB row to (a) avoid
 * drift, (b) pick up post-enqueue admin edits, and (c) get the row's
 * canonical seed for the iteration.
 */
interface VideoSfxInputData {
  type?: "video-sfx"
  videoUrl: string
  prompt?: string
  negativePrompt?: string
  cfgStrength: number
  numSteps: number
  seed?: number
  duration_seconds: number
  bucketKey?: string
  iterationIndex?: number
  iterationTotal?: number
}

const handleVideoSfx: HandlerFn = async function handleVideoSfx(job, ctx) {
  // ──────────────────────────────────────────────────────────────────────
  // Re-read input_data from the jobs row (single source of truth) — NOT
  // from the BullMQ payload. The route inserted the row first; the BullMQ
  // payload is a parity convenience that can drift if an admin edits the
  // row before pickup.
  // ──────────────────────────────────────────────────────────────────────
  const { data: jobRow, error: jobErr } = await supabase
    .from("jobs")
    .select("input_data")
    .eq("id", ctx.jobId)
    .single()
  if (jobErr || !jobRow) {
    throw new Error(`video-sfx: failed to load jobs row ${ctx.jobId}: ${jobErr?.message ?? "row not found"}`)
  }
  const input = jobRow.input_data as VideoSfxInputData | null
  if (!input || typeof input !== "object" || typeof input.videoUrl !== "string") {
    throw new Error(`video-sfx: jobs row ${ctx.jobId} has malformed input_data`)
  }

  const {
    videoUrl,
    prompt,
    negativePrompt,
    cfgStrength,
    numSteps,
    seed,
    duration_seconds: durationSeconds,
    iterationIndex,
    iterationTotal,
  } = input

  console.log(
    `[worker] video-sfx ${ctx.jobId} (duration: ${durationSeconds}s` +
    (iterationTotal && iterationTotal > 1 ? `, iter ${(iterationIndex ?? 0) + 1}/${iterationTotal}` : "") +
    `)`,
  )

  // Persist provider_kind + provider_task_id (the prediction.id) the
  // moment Replicate gives us a prediction. If the worker crashes during
  // `replicate.wait`, the reconcile cron's 20-min sweep recovers the row.
  // The pre-task sentinel written by video-worker.ts:148 covers the
  // crash window BEFORE this callback fires.
  const onTaskCreated = makeOnTaskCreated(ctx.jobId, "replicate-prediction")

  // Wrap the Replicate call in a progress ramp so the widget bar moves
  // during the long wait. MMAudio runs ~3-10s per second of input video;
  // a 60s clip can take 1-2 min. Without the ramp the bar sits at 0%.
  const result = await withProgressRamp(
    job,
    ctx.jobId,
    { start: 5, cap: 45 },
    () => generateVideoSfx(
      {
        videoUrl,
        prompt,
        negativePrompt,
        duration: durationSeconds,
        cfgStrength,
        numSteps,
        seed,
      },
      { onTaskCreated },
    ),
  )
  await setJobProgress(job, ctx.jobId, 50)

  // Upload to R2. mmaudio's output is the user's original video with
  // generated SFX merged in — the user can still see their content, so we
  // honor the same watermark policy as face-swap / video-to-video (free
  // tier sees a "Nodaro.ai" overlay; paid tiers don't).
  const r2Url = await uploadVideoMaybeWatermark(
    result.outputUrl,
    ctx.jobId,
    ctx.jobUserId,
    ctx.shouldWatermark,
  )
  await setJobProgress(job, ctx.jobId, 100)

  const thumbUrl = await generateAndUploadThumbnail(r2Url, ctx.jobId, ctx.jobUserId)

  // finalize: video-to-video is the closest FinalizeJobType — VIDEO_TYPES
  // path uploads via uploadVideoMaybeWatermark (we already did) and writes
  // output_data.videoUrl. We pass mediaUrl so finalize doesn't re-upload.
  // Cost is null (Replicate predict_time → markup happens via the bucket-
  // pricing reservation, not per-prediction). providerUsed is the model
  // identifier so admin / audit views can see the route.
  const { ok } = await finalizeJobWithMedia({
    jobId: ctx.jobId,
    jobType: "video-to-video",
    result: {
      url: result.outputUrl,
      cost: null,
      providerUsed: "replicate-mmaudio",
    },
    mediaUrl: r2Url,
    extraOutputData: {
      thumbnailUrl: thumbUrl,
      ...buildProviderMeta({ providerMs: Math.round(result.predictTime * 1000) }),
    },
  })
  if (!ok) return

  console.log(
    `[worker] Job ${ctx.jobId} completed: ${r2Url} ` +
    `(provider: replicate-mmaudio, prediction: ${result.predictionId}, ` +
    `predictTime: ${result.predictTime.toFixed(2)}s)`,
  )
}

export const videoSfxHandlers: Record<string, HandlerFn> = {
  "video-sfx": handleVideoSfx,
}
