/**
 * Delivery of a finished ElevenLabs dub — shared between the worker
 * (`handleDubbing`) and the reconcile lane (`reconcileElevenLabsJob`).
 *
 * With the long-source early-return policy, the reconcile cron is a NORMAL
 * completion path for dubbing, not disaster recovery — so worker and cron must
 * produce byte-identical results: same R2 keys, same `output_data` shape, same
 * thumbnail, same asset row, same credit commit. One function, two callers, no
 * twins to drift.
 *
 * Audio mode mirrors the historical dubbing delivery (mp3 → finalize as
 * "text-to-audio"). Video mode mirrors voice-changer's video mode: dubbed
 * video + extracted audio sidecar + thumbnail via the CAS-guarded
 * `markJobCompleted` (single-shot against every terminal state, so a cron and
 * a worker racing the same job cannot double-deliver or double-commit).
 */
// @reads-none reads only the audio track it extracts into a work dir
import { promises as fs } from "node:fs"
import { join } from "node:path"
import { supabase } from "./supabase.js"
import { uploadBufferToR2, mediaObjectKey } from "./storage.js"
import { runPostProcessing } from "./post-processing-error.js"
import { finalizeJobWithMedia, type FinalizeClaimant } from "./job-finalize.js"
import { createWorkDir, cleanupWorkDir, probeMediaDuration } from "../providers/video/ffmpeg-utils.js"
import { DUBBING_FALLBACK_SECONDS } from "../providers/elevenlabs/dubbing.js"
import { dubbingBaseCreditsFor, effectiveDubbedSeconds } from "./dubbing-span.js"
import { dubbingModelIdOfRequest } from "./dubbing-model.js"
import { assertServiceSpanWithinHold } from "./dubbing-source-bytes.js"
import { elevenlabsDubbingCostUsd } from "./pricing/elevenlabs-dubbing-cost.js"
import { extractAudioTrack } from "../providers/video/extract-audio-track.js"
import {
  commitJobCredits,
  markJobCompleted,
  shouldSaveJobResult,
  generateAndUploadThumbnail,
  createAssetFromJob,
  watermarkLocalVideoAndUpload,
} from "../workers/shared.js"

export interface DeliverDubbedMediaArgs {
  jobId: string
  userId?: string
  /** The dubbed media bytes as downloaded from ElevenLabs. */
  buffer: Buffer
  videoMode: boolean
  /**
   * Nodaro free-tier watermark on the dubbed VIDEO. The worker resolves it
   * from ctx (voice-changer video-mode precedent); the reconcile path passes
   * false — matching the KIE reconcile precedent, where cron-recovered videos
   * skip the watermark step (stated delta, not an accident).
   */
  shouldWatermark: boolean
  /** The worker passes ctx.usageLogId; the cron omits it and it is loaded. */
  usageLogId?: string | null
  /** Finalize attribution for the audio path ("cron" from the reconcile lane). */
  claimant?: FinalizeClaimant
  /** ElevenLabs' own reading of the source's length (`media_metadata.duration`
   *  on the final status). Settles a run that was held at the 30-minute
   *  ceiling because its length could not be read before it started. */
  mediaDurationSec?: number
  /** The job's own request — its queue payload (worker) or input_data
   *  (reconcile lane): whether it was held at the ceiling, and its window. */
  request?: Readonly<Record<string, unknown>>
}

/** What the request says about its reservation, its price row and its window. */
interface DubbingSettleContext {
  readonly reservedCeiling: boolean
  /** The row the run was reserved on: the one the server stamped, else its language's. */
  readonly modelId: string
  readonly startTime?: number
  readonly endTime?: number
  /** The span measured before the hold, for a run not held at the ceiling. */
  readonly probedDurationSec?: number
  /** The dub asked the service for its own watermark (a lower vendor rate). */
  readonly watermark: boolean
}

function settleContextOf(request: Readonly<Record<string, unknown>> | undefined): DubbingSettleContext {
  const input = request ?? {}
  return {
    reservedCeiling: input.reservedCeiling === true,
    modelId: dubbingModelIdOfRequest(input),
    startTime: typeof input.startTime === "number" ? input.startTime : undefined,
    endTime: typeof input.endTime === "number" ? input.endTime : undefined,
    probedDurationSec: typeof input.probedDurationSec === "number" && input.probedDurationSec > 0 ? input.probedDurationSec : undefined,
    watermark: input.watermark === true,
  }
}

/**
 * The length of a delivered file in seconds, unrounded, or undefined when it
 * cannot be read: the charge forgives a hair past a minute
 * (`dubbingHeldMinutes`, through `dubbingBaseCredits`), so rounding up to a
 * whole second first would lose that grace (a 60.02 s dub is 1 minute).
 */
async function deliveredSeconds(path: string): Promise<number | undefined> {
  try {
    const seconds = await probeMediaDuration(path)
    return Number.isFinite(seconds) && seconds > 0 ? seconds : undefined
  } catch {
    return undefined
  }
}

/**
 * The span a dub was dubbed for: the span measured before the hold, or — for
 * a run held at the 30-minute ceiling — the span read from ElevenLabs'
 * metadata, else from the delivered file, else the 2-minute last resort.
 * Unrounded: the charge forgives a hair past a minute (`dubbingHeldMinutes`).
 * Undefined for a measured run that carries no span (a job queued before the
 * span rode it).
 */
async function dubbedSpanSec(
  ctx: DubbingSettleContext,
  mediaDurationSec: number | undefined,
  readDelivered: () => Promise<number | undefined>,
): Promise<number | undefined> {
  if (!ctx.reservedCeiling) {
    if (ctx.probedDurationSec === undefined) return undefined
    // The larger of the span held and the span the service read (within the hold's tolerance, or it was refused).
    const service = typeof mediaDurationSec === "number" && mediaDurationSec > 0
      ? (effectiveDubbedSeconds(mediaDurationSec, ctx.startTime, ctx.endTime) ?? mediaDurationSec)
      : undefined
    return service !== undefined ? Math.max(ctx.probedDurationSec, service) : ctx.probedDurationSec
  }
  const fromMetadata = typeof mediaDurationSec === "number" && mediaDurationSec > 0 ? mediaDurationSec : undefined
  const sourceSec = fromMetadata ?? (await readDelivered())
  return sourceSec != null
    ? (effectiveDubbedSeconds(sourceSec, ctx.startTime, ctx.endTime) ?? sourceSec)
    : DUBBING_FALLBACK_SECONDS
}

/**
 * The BASE credits a ceiling-held run settles at: the span dubbed — never the
 * 30-minute hold itself. Undefined when the run was not held at the ceiling:
 * its reservation was the measured span, committed as is.
 */
async function ceilingSettleBase(ctx: DubbingSettleContext, spanSec: number | undefined): Promise<number | undefined> {
  if (!ctx.reservedCeiling || spanSec === undefined) return undefined
  return dubbingBaseCreditsFor(ctx.modelId, spanSec)
}

/** What the dub cost the platform (`jobs.provider_cost`), in USD; null when its span is not known. */
function dubbingProviderCost(ctx: DubbingSettleContext, spanSec: number | undefined): number | null {
  return spanSec === undefined ? null : elevenlabsDubbingCostUsd(ctx.modelId, spanSec, { watermark: ctx.watermark })
}

async function loadReservedUsageLogId(jobId: string): Promise<string | null> {
  const { data } = await supabase
    .from("usage_logs")
    .select("id")
    .eq("job_id", jobId)
    .eq("status", "reserved")
    .limit(1)
  return (data?.[0] as { id: string } | undefined)?.id ?? null
}

export async function deliverDubbedMedia(args: DeliverDubbedMediaArgs): Promise<{ ok: boolean; url: string | null }> {
  const { jobId, userId, buffer, videoMode } = args
  const settle = settleContextOf(args.request)
  // A dub the service read as longer than its hold is never delivered, on
  // either lane — the worker's or the reconcile cron's (a dub parked for its
  // length, or still dubbing when the worker stopped waiting): the job fails
  // and is refunded (a DeterministicJobError, before anything is uploaded).
  if (typeof args.mediaDurationSec === "number" && args.mediaDurationSec > 0) {
    assertServiceSpanWithinHold(args.mediaDurationSec, settle)
  }

  if (!videoMode) {
    // POST-PROVIDER: ElevenLabs already produced + delivered the dub (we were
    // billed) — an R2 upload failure here is post-delivery, so skip the refund.
    const r2Url = await runPostProcessing(() =>
      uploadBufferToR2(buffer, mediaObjectKey(jobId, "audio", "mp3"), "audio/mpeg", userId),
    )
    const spanSec = await dubbedSpanSec(settle, args.mediaDurationSec, async () => {
      const dir = await createWorkDir("dub-audio-length")
      try {
        const path = join(dir, "dubbed.mp3")
        await fs.writeFile(path, buffer)
        return await deliveredSeconds(path)
      } finally {
        await cleanupWorkDir(dir)
      }
    })
    const meteredBaseCredits = await ceilingSettleBase(settle, spanSec)
    const { ok } = await finalizeJobWithMedia({
      jobId,
      jobType: "text-to-audio",
      ...(args.claimant ? { claimant: args.claimant } : {}),
      // What the dub cost is recorded (provider_cost); the charge is the hold or the ceiling's settle below.
      result: { url: r2Url, cost: dubbingProviderCost(settle, spanSec), providerUsed: "elevenlabs-dubbing" },
      mediaUrl: r2Url,
      // A ceiling-held run settles to the span dubbed (count-based, never above the hold).
      ...(meteredBaseCredits !== undefined ? { meteredBaseCredits } : {}),
    })
    return { ok, url: r2Url }
  }

  // ── Video mode ────────────────────────────────────────────────────────────
  // Buffer → temp file → (maybe watermark +) upload; then the audio sidecar
  // and thumbnail, then the CAS'd completion. All post-provider.
  const workDir = await createWorkDir("dub-video")
  let videoR2Url: string
  let videoSeconds: number | undefined
  try {
    const localPath = join(workDir, "dubbed.mp4")
    await fs.writeFile(localPath, buffer)
    // Read before the work dir goes: a ceiling-held run without ElevenLabs'
    // own reading settles by the length of what was delivered.
    if (settle.reservedCeiling && !(typeof args.mediaDurationSec === "number" && args.mediaDurationSec > 0)) {
      videoSeconds = await deliveredSeconds(localPath)
    }
    // watermarkLocalVideoAndUpload wraps its own runPostProcessing.
    videoR2Url = await watermarkLocalVideoAndUpload(localPath, jobId, userId, args.shouldWatermark)
  } finally {
    await cleanupWorkDir(workDir)
  }

  // Audio sidecar — the dubbed dialogue track alone, surfaced on the node's
  // audio output handle (mirrors voice-changer's video-mode contract). A dub
  // always carries audio; failure here degrades to video-only, never fails
  // the delivered job.
  let audioR2Url: string | undefined
  try {
    const { audioPath, workDir: extractDir } = await extractAudioTrack(videoR2Url)
    try {
      const audioBuffer = await fs.readFile(audioPath)
      audioR2Url = await runPostProcessing(() =>
        uploadBufferToR2(audioBuffer, mediaObjectKey(jobId, "audio", "mp3"), "audio/mpeg", userId),
      )
    } finally {
      await cleanupWorkDir(extractDir)
    }
  } catch (err) {
    console.warn(`[dubbing] ${jobId}: audio sidecar extraction failed — delivering video-only: ${err instanceof Error ? err.message : String(err)}`)
  }

  const thumbnailUrl = await generateAndUploadThumbnail(videoR2Url, jobId, userId)

  if (!(await shouldSaveJobResult(jobId))) return { ok: false, url: videoR2Url }
  const spanSec = await dubbedSpanSec(settle, args.mediaDurationSec, async () => videoSeconds)
  const providerCost = dubbingProviderCost(settle, spanSec)
  const ok = await markJobCompleted(jobId, {
    output_data: {
      videoUrl: videoR2Url,
      ...(audioR2Url ? { audioUrl: audioR2Url } : {}),
      ...(thumbnailUrl ? { thumbnailUrl } : {}),
      providerUsed: "elevenlabs-dubbing",
    },
    // What the dub cost the platform, recorded beside its charge.
    ...(providerCost !== null ? { provider_cost: providerCost } : {}),
  })
  if (!ok) return { ok: false, url: videoR2Url }
  const usageLogId = args.usageLogId ?? (await loadReservedUsageLogId(jobId))
  // A ceiling-held run settles to the span dubbed: count-based, marked up at
  // the reservation's margin, never above the hold (commitJobCredits' metered
  // branch; the USD argument stays null so nothing reprices from dollars).
  const meteredBaseCredits = await ceilingSettleBase(settle, spanSec)
  if (meteredBaseCredits !== undefined) {
    await commitJobCredits(usageLogId, jobId, null, meteredBaseCredits, true)
  } else {
    await commitJobCredits(usageLogId, jobId)
  }
  await createAssetFromJob(jobId, userId)
  return { ok: true, url: videoR2Url }
}
