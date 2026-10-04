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
import { promises as fs } from "node:fs"
import { join } from "node:path"
import { supabase } from "./supabase.js"
import { uploadBufferToR2, mediaObjectKey } from "./storage.js"
import { runPostProcessing } from "./post-processing-error.js"
import { finalizeJobWithMedia, type FinalizeClaimant } from "./job-finalize.js"
import { createWorkDir, cleanupWorkDir, probeMediaDuration } from "../providers/video/ffmpeg-utils.js"
import { DUBBING_FALLBACK_SECONDS } from "../providers/elevenlabs/dubbing.js"
import { dubbingBaseCredits, effectiveDubbedSeconds } from "./dubbing-span.js"
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

/** What the request says about its reservation and its window. */
interface DubbingSettleContext {
  readonly reservedCeiling: boolean
  readonly targetLanguage: unknown
  readonly startTime?: number
  readonly endTime?: number
}

function settleContextOf(request: Readonly<Record<string, unknown>> | undefined): DubbingSettleContext {
  const input = request ?? {}
  return {
    reservedCeiling: input.reservedCeiling === true,
    targetLanguage: input.targetLanguage,
    startTime: typeof input.startTime === "number" ? input.startTime : undefined,
    endTime: typeof input.endTime === "number" ? input.endTime : undefined,
  }
}

/** The length of a delivered file in whole seconds, or undefined when it cannot be read. */
async function deliveredSeconds(path: string): Promise<number | undefined> {
  try {
    const seconds = await probeMediaDuration(path)
    return Number.isFinite(seconds) && seconds > 0 ? Math.ceil(seconds) : undefined
  } catch {
    return undefined
  }
}

/**
 * The BASE credits a ceiling-held run settles at: the dubbed span read from
 * ElevenLabs' metadata, else from the delivered file, else the 2-minute last
 * resort — never the 30-minute hold itself. Undefined when the run was not
 * held at the ceiling: its reservation was the measured span, committed as is.
 */
async function ceilingSettleBase(
  ctx: DubbingSettleContext,
  mediaDurationSec: number | undefined,
  readDelivered: () => Promise<number | undefined>,
): Promise<number | undefined> {
  if (!ctx.reservedCeiling) return undefined
  const fromMetadata = typeof mediaDurationSec === "number" && mediaDurationSec > 0 ? Math.ceil(mediaDurationSec) : undefined
  const sourceSec = fromMetadata ?? (await readDelivered())
  const span = sourceSec != null
    ? (effectiveDubbedSeconds(sourceSec, ctx.startTime, ctx.endTime) ?? sourceSec)
    : DUBBING_FALLBACK_SECONDS
  return dubbingBaseCredits(ctx.targetLanguage, span)
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

  if (!videoMode) {
    // POST-PROVIDER: ElevenLabs already produced + delivered the dub (we were
    // billed) — an R2 upload failure here is post-delivery, so skip the refund.
    const r2Url = await runPostProcessing(() =>
      uploadBufferToR2(buffer, mediaObjectKey(jobId, "audio", "mp3"), "audio/mpeg", userId),
    )
    const meteredBaseCredits = await ceilingSettleBase(settle, args.mediaDurationSec, async () => {
      const dir = await createWorkDir("dub-audio-length")
      try {
        const path = join(dir, "dubbed.mp3")
        await fs.writeFile(path, buffer)
        return await deliveredSeconds(path)
      } finally {
        await cleanupWorkDir(dir)
      }
    })
    const { ok } = await finalizeJobWithMedia({
      jobId,
      jobType: "text-to-audio",
      ...(args.claimant ? { claimant: args.claimant } : {}),
      result: { url: r2Url, cost: null, providerUsed: "elevenlabs-dubbing" },
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
  const ok = await markJobCompleted(jobId, {
    output_data: {
      videoUrl: videoR2Url,
      ...(audioR2Url ? { audioUrl: audioR2Url } : {}),
      ...(thumbnailUrl ? { thumbnailUrl } : {}),
      providerUsed: "elevenlabs-dubbing",
    },
  })
  if (!ok) return { ok: false, url: videoR2Url }
  const usageLogId = args.usageLogId ?? (await loadReservedUsageLogId(jobId))
  // A ceiling-held run settles to the span dubbed: count-based, marked up at
  // the reservation's margin, never above the hold (commitJobCredits' metered
  // branch; the USD argument stays null so nothing reprices from dollars).
  const meteredBaseCredits = await ceilingSettleBase(settle, args.mediaDurationSec, async () => videoSeconds)
  if (meteredBaseCredits !== undefined) {
    await commitJobCredits(usageLogId, jobId, null, meteredBaseCredits, true)
  } else {
    await commitJobCredits(usageLogId, jobId)
  }
  await createAssetFromJob(jobId, userId)
  return { ok: true, url: videoR2Url }
}
