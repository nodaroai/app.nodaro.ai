import { dirname } from "node:path"
import { mergeVideoAudio } from "../providers/video/merge-video-audio.js"
import { cleanupWorkDir, probeMediaStreams } from "../providers/video/ffmpeg-utils.js"
import { uploadVideoMaybeWatermark, watermarkLocalVideoAndUpload } from "../workers/shared.js"
import { draftAudioMuxMergeArgs, type DraftAudioMux } from "./seedance-draft-audio.js"
import { videoStreamSeconds } from "./seedance-draft-finalize.js"

/** The ffmpeg half of `seedance-draft-audio.ts`: re-apply a draft's audio mux to its 1080p render. */
function mergeFor(videoUrl: string, mux: DraftAudioMux): Promise<string> {
  return mergeVideoAudio(draftAudioMuxMergeArgs(videoUrl, mux))
}

/**
 * How far apart (seconds) the stored clip's picture and the take's may be and
 * still carry the same audio: two frames at 24 fps (≈83 ms). VIDEO streams
 * are compared, never containers — a muxed AI clip's audio track runs a frame
 * or two past its picture (backend/CLAUDE.md, PRECISION INVARIANT).
 */
export const COPY_LENGTH_TOLERANCE_SEC = 2 / 24

/** A recipe applied: the merged file, or why the picture goes out as rendered. */
type MuxOutcome =
  | { readonly kind: "merged"; readonly path: string }
  /** The stored clip has no audio stream: there was no audio to keep (no warning). */
  | { readonly kind: "no-audio" }
  /** The stored clip's picture is not the take's length (Smart Loop Cut, a trim):
   *  its audio would come out truncated or out of sync (warning). */
  | { readonly kind: "length-mismatch" }

/**
 * Copy the stored draft's audio onto the 1080p picture. Two outcomes deliver
 * the picture as rendered instead, and stay distinct: the clip has NO audio
 * stream (nothing to copy — a draft whose stored clip is silent had no audio
 * to keep), or its picture is not the take's length (the copy would truncate
 * or desync the audio). Both the primary `copy-draft-audio` recipe and the
 * fallback of every other recipe come through here.
 */
async function copyDraftAudio(videoUrl: string, draftVideoUrl: string): Promise<MuxOutcome> {
  const streams = await probeMediaStreams(draftVideoUrl)
  if (!streams.hasAudio) {
    console.warn("[seedance-draft-audio] the stored draft has no audio stream; delivering the 1080p render as rendered")
    return { kind: "no-audio" }
  }
  const [take, stored] = await Promise.all([videoStreamSeconds(videoUrl), videoStreamSeconds(draftVideoUrl)])
  if (!(Math.abs(take - stored) <= COPY_LENGTH_TOLERANCE_SEC)) {
    console.warn(
      `[seedance-draft-audio] the stored draft's picture (${stored.toFixed(3)} s) is not the 1080p take's length (${take.toFixed(3)} s); delivering the 1080p render without its audio`,
    )
    return { kind: "length-mismatch" }
  }
  return { kind: "merged", path: await mergeFor(videoUrl, { kind: "copy-draft-audio", draftVideoUrl }) }
}

/** Shown when the draft's audio could not be re-applied (decided 2026-10-12). */
export const DRAFT_AUDIO_NOT_REAPPLIED = {
  code: "draft_audio_not_reapplied",
  message:
    "The 1080p video was delivered without the draft's audio: it could not be re-applied. Add it back with a Merge Video & Audio node.",
} as const

export interface DraftAudioMuxResult {
  /** The delivered clip's R2 URL. */
  readonly url: string
  /** Set when the audio could not be re-applied and the picture went out silent. */
  readonly warning?: { readonly code: string; readonly message: string }
}

/**
 * A 5xx counts only where a status is reported, never as a bare number (an
 * ffmpeg message is full of them: "544x960", "frame=512"):
 * - `downloadFile` (the merge's inputs): `Failed to download: <url> (503)`;
 * - ffprobe of a remote URL (`probeMediaStreams`, `getVideoStreamDuration`):
 *   libavformat's `Server returned 5XX Server Error reply`.
 */
const TRANSIENT_RE = /ECONNRESET|ETIMEDOUT|EAI_AGAIN|ENOTFOUND|ECONNREFUSED|EPIPE|socket hang up|fetch failed|network|timed? ?out|Failed to download: \S+ \(5\d\d\)|Server returned 5XX/i

/** A storage / network hiccup worth one more short try; anything else (ffmpeg refusing, an unreadable file) will fail the same way again. */
export function isTransientMuxError(err: unknown): boolean {
  const msg = err instanceof Error ? `${err.message} ${String((err as { cause?: unknown }).cause ?? "")}` : String(err)
  return TRANSIENT_RE.test(msg)
}

/** Short, bounded backoff for a transient failure: the user never waits on retries for long. */
export const TRANSIENT_RETRY_DELAYS_MS: readonly number[] = [2_000, 5_000]

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

/** The recipe, falling back to the stored draft's audio when the recipe's own source fails. */
async function muxOnce(args: { videoUrl: string; mux: DraftAudioMux; draftVideoUrl?: string }): Promise<MuxOutcome> {
  if (args.mux.kind === "copy-draft-audio") return copyDraftAudio(args.videoUrl, args.mux.draftVideoUrl)
  try {
    return { kind: "merged", path: await mergeFor(args.videoUrl, args.mux) }
  } catch (err) {
    if (!args.draftVideoUrl) throw err
    console.warn(`[seedance-draft-audio] re-applying the draft's ${args.mux.kind} mux failed; copying the stored draft's audio instead:`, err)
    return copyDraftAudio(args.videoUrl, args.draftVideoUrl)
  }
}

/**
 * Re-apply `mux` to the 1080p render at `videoUrl`, then watermark (when the
 * job is watermarked) and upload.
 *
 * - When the recipe's own audio source can no longer be read (a caller's
 *   `audioUrl` that has since gone away), the stored draft's audio stream —
 *   the result of that very mux — is copied instead.
 * - A copy from a stored clip with no audio stream delivers the picture as
 *   rendered (there was no audio to keep) — no warning.
 * - A copy from a stored clip whose picture is not the take's length (Smart
 *   Loop Cut, a trim) would truncate or desync the audio: the picture goes
 *   out WITHOUT audio, with {@link DRAFT_AUDIO_NOT_REAPPLIED}.
 * - Otherwise a failure never discards the paid render (decided 2026-10-12):
 *   a transient one (network / storage) gets a short bounded retry, and then —
 *   or at once for a deterministic one — the 1080p picture is delivered
 *   WITHOUT audio and the result carries {@link DRAFT_AUDIO_NOT_REAPPLIED}.
 */
export async function applyDraftAudioMux(args: {
  videoUrl: string
  mux: DraftAudioMux
  /** The stored draft clip, for the copy fallback. */
  draftVideoUrl?: string
  jobId: string
  userId: string | undefined
  watermark: boolean
  /** Injectable for tests. */
  sleep?: (ms: number) => Promise<void>
}): Promise<DraftAudioMuxResult> {
  const sleep = args.sleep ?? defaultSleep
  let outcome: MuxOutcome | undefined
  for (let attempt = 0; ; attempt++) {
    try {
      outcome = await muxOnce(args)
      break
    } catch (err) {
      const retry = isTransientMuxError(err) && attempt < TRANSIENT_RETRY_DELAYS_MS.length
      console.warn(
        `[seedance-draft-audio] job ${args.jobId}: re-applying the draft's audio failed (attempt ${attempt + 1}${retry ? ", retrying" : ", delivering without audio"}):`,
        err,
      )
      if (!retry) break
      await sleep(TRANSIENT_RETRY_DELAYS_MS[attempt]!)
    }
  }
  if (outcome?.kind !== "merged") {
    const url = await uploadVideoMaybeWatermark(args.videoUrl, args.jobId, args.userId, args.watermark)
    // Silent without a warning only when there was no audio to keep.
    return outcome?.kind === "no-audio" ? { url } : { url, warning: { ...DRAFT_AUDIO_NOT_REAPPLIED } }
  }
  const merged = outcome.path
  try {
    return { url: await watermarkLocalVideoAndUpload(merged, args.jobId, args.userId, args.watermark) }
  } finally {
    await cleanupWorkDir(dirname(merged))
  }
}

/** The `extraOutputData` a finalize records for a mux result's warning (empty when none). */
export function draftAudioWarningOutputData(result: DraftAudioMuxResult): { warningCode?: string; warningMessage?: string } {
  return result.warning ? { warningCode: result.warning.code, warningMessage: result.warning.message } : {}
}
