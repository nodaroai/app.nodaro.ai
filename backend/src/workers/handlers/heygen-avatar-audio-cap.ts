/**
 * AUDIO-mode length cap for the ai-avatar worker.
 *
 * HeyGen has no natural length limit on an audio-driven avatar, so a long
 * audio = an expensive (or possibly rejected) generation and a bounded
 * under-reserve window — the credit RESERVE is capped at the 600s bucket
 * (`resolveAiAvatarCreditId` in @nodaro/shared) but the actual clip is not.
 *
 * This helper closes that gap on the worker side: it probes the driving audio
 * and, when it runs longer than `AI_AVATAR_MAX_AUDIO_SEC`, trims it down to the
 * first 600s (re-hosted to R2) so the HeyGen call — and thus the billed clip —
 * can never exceed the reserved 600s bucket. It also returns a non-fatal,
 * user-facing warning string so the ai-avatar node can show why the output is
 * shorter than the source.
 *
 * Best-effort: a probe or trim failure is logged and the ORIGINAL url is used
 * (do not fail the whole job over the warning path). The only downside of a
 * failed trim is the (already-flagged) cost risk of a >600s clip running
 * against a 600s reserve — a bounded under-reserve, never an over-charge.
 *
 * Mirrors the worker download → ffmpeg → upload patterns in
 * `providers/video/ffmpeg-utils.ts` + `workers/shared.ts::downloadAudioToR2`.
 */

import { extname } from "node:path"
import { promises as fs } from "node:fs"
import { join } from "node:path"
import { randomUUID } from "node:crypto"
import { AI_AVATAR_MAX_AUDIO_SEC } from "@nodaro/shared"
import {
  downloadFile,
  runFfmpeg,
  probeMediaDuration,
  createWorkDir,
  cleanupWorkDir,
} from "../../providers/video/ffmpeg-utils.js"
import { uploadFileWithKeyToR2 } from "../../lib/storage.js"

/** Audio container/MIME pairs we recognise; falls back to mp3 stream-copy. */
const AUDIO_MIME: Record<string, string> = {
  ".mp3": "audio/mpeg",
  ".m4a": "audio/mp4",
  ".aac": "audio/aac",
  ".wav": "audio/wav",
  ".ogg": "audio/ogg",
  ".opus": "audio/ogg",
  ".flac": "audio/flac",
  ".webm": "audio/webm",
}

export interface AudioCapResult {
  /** URL to feed HeyGen — the TRIMMED R2 url when capped, else the original. */
  audioUrl: string
  /** Non-fatal warning to surface to the user, or undefined when no cap applied. */
  warning?: string
}

/** Format a seconds count as "M:SS" for the user-facing warning. */
function formatClock(totalSec: number): string {
  const whole = Math.round(totalSec)
  const mins = Math.floor(whole / 60)
  const secs = whole % 60
  return `${mins}:${secs.toString().padStart(2, "0")}`
}

/**
 * Cap an audio-mode driving track to AI_AVATAR_MAX_AUDIO_SEC.
 *
 * @param audioUrl       The driving audio url (R2-hosted in the normal flow).
 * @param jobId          Owning job id — used for the R2 key + storage tracking.
 * @param jobUserId      Owning user — used for storage tracking.
 * @param probedDurationSec Optional already-known duration (seconds) to avoid a
 *                       second ffprobe. When omitted/invalid the audio is probed.
 * @returns the url to use + an optional warning. On any error, returns the
 *          original url with no warning (best-effort; logged to console).
 */
export async function capAudioForAvatar(
  audioUrl: string,
  jobId: string,
  jobUserId: string | undefined,
  probedDurationSec?: number,
): Promise<AudioCapResult> {
  try {
    const duration =
      typeof probedDurationSec === "number" &&
      Number.isFinite(probedDurationSec) &&
      probedDurationSec > 0
        ? probedDurationSec
        : await probeMediaDuration(audioUrl)

    // <= cap: leave the audio untouched, no warning.
    if (duration <= AI_AVATAR_MAX_AUDIO_SEC) {
      return { audioUrl }
    }

    const workDir = await createWorkDir("ai-avatar-audio-cap")
    try {
      const inExt = pickAudioExt(audioUrl)
      const inPath = join(workDir, `in${inExt}`)
      // We re-encode to AAC (see below), so the OUTPUT is always an .m4a/AAC
      // file regardless of the source container — naming it after the source
      // ext would mislabel (e.g. a .wav holding AAC).
      const outExt = ".m4a"
      const outPath = join(workDir, `out${outExt}`)

      await downloadFile(audioUrl, inPath)

      // Trim to the first AI_AVATAR_MAX_AUDIO_SEC seconds. Stream-copy would be
      // cheaper, but a `-t` cut with stream-copy lands on the next packet
      // boundary (can over/under-shoot the target length depending on the
      // source codec), so we re-encode to AAC for an exact-length, glitch-free
      // cut that HeyGen's audio mode accepts universally.
      await runFfmpeg([
        "-y",
        "-i", inPath,
        "-t", String(AI_AVATAR_MAX_AUDIO_SEC),
        "-c:a", "aac",
        "-b:a", "192k",
        "-vn",
        outPath,
      ])

      const key = `audios/ai-avatar-cap-${jobId}-${randomUUID()}${outExt}`
      const trimmedUrl = await uploadFileWithKeyToR2(
        outPath,
        key,
        AUDIO_MIME[outExt]!,
        jobUserId,
      )

      const warning =
        `Audio was ${formatClock(duration)} — trimmed to the ` +
        `${formatClock(AI_AVATAR_MAX_AUDIO_SEC)} max for AI Avatar.`

      console.log(
        `[worker] ai-avatar ${jobId}: audio ${duration.toFixed(1)}s > ` +
        `${AI_AVATAR_MAX_AUDIO_SEC}s cap — trimmed to ${trimmedUrl}`,
      )

      return { audioUrl: trimmedUrl, warning }
    } finally {
      await cleanupWorkDir(workDir)
    }
  } catch (err) {
    // Best-effort: never fail the whole job over the cap path. Proceed with the
    // ORIGINAL audio. The reserve is already capped at the 600s bucket, so a
    // failed trim is a bounded under-reserve (cost risk), not an over-charge.
    console.error(
      `[worker] ai-avatar ${jobId}: audio cap failed (proceeding with original, ` +
      `cost risk if >${AI_AVATAR_MAX_AUDIO_SEC}s):`,
      err,
    )
    return { audioUrl }
  }
}

/** Pick a safe lowercase audio extension from the url, defaulting to .m4a. */
function pickAudioExt(url: string): string {
  try {
    const pathname = new URL(url).pathname
    const ext = extname(pathname).toLowerCase()
    if (ext && AUDIO_MIME[ext]) return ext
  } catch {
    const ext = extname(url).toLowerCase()
    if (ext && AUDIO_MIME[ext]) return ext
  }
  // AAC in an MP4 container is the re-encode target; .m4a is the natural ext.
  return ".m4a"
}
