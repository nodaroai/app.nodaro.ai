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
import { createWorkDir, cleanupWorkDir } from "../providers/video/ffmpeg-utils.js"
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

  if (!videoMode) {
    // POST-PROVIDER: ElevenLabs already produced + delivered the dub (we were
    // billed) — an R2 upload failure here is post-delivery, so skip the refund.
    const r2Url = await runPostProcessing(() =>
      uploadBufferToR2(buffer, mediaObjectKey(jobId, "audio", "mp3"), "audio/mpeg", userId),
    )
    const { ok } = await finalizeJobWithMedia({
      jobId,
      jobType: "text-to-audio",
      ...(args.claimant ? { claimant: args.claimant } : {}),
      result: { url: r2Url, cost: null, providerUsed: "elevenlabs-dubbing" },
      mediaUrl: r2Url,
    })
    return { ok, url: r2Url }
  }

  // ── Video mode ────────────────────────────────────────────────────────────
  // Buffer → temp file → (maybe watermark +) upload; then the audio sidecar
  // and thumbnail, then the CAS'd completion. All post-provider.
  const workDir = await createWorkDir("dub-video")
  let videoR2Url: string
  try {
    const localPath = join(workDir, "dubbed.mp4")
    await fs.writeFile(localPath, buffer)
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
  await commitJobCredits(usageLogId, jobId)
  await createAssetFromJob(jobId, userId)
  return { ok: true, url: videoR2Url }
}
