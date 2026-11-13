import { join } from "node:path"
import { config } from "./config.js"
import { supabase } from "./supabase.js"
import { downloadFile, getVideoStreamDuration, runFfmpeg } from "../providers/video/ffmpeg-utils.js"
import { reencodePeakMemoryMiB } from "../providers/video/video-file-stages.js"
import {
  probeReferenceVideo,
  referenceVideoAudio,
  referenceVideoPictureArgs,
  referenceVideoTargetBitRate,
  SEEDANCE_2_5_REF_VIDEO_MAX_BYTES,
  type ReferenceVideoProbe,
} from "../providers/kie/reference-video-reencode.js"

/**
 * Is this URL's OBJECT a QuickTime container? Decided by the path, never by
 * the whole string — KIE result URLs carry signed query strings, and a
 * `?f=.mov` on an mp4 (or an `.mov` before a `?token=…`) must not flip the
 * answer.
 */
export function isMovUrl(url: string): boolean {
  try {
    return new URL(url).pathname.toLowerCase().endsWith(".mov")
  } catch {
    return false
  }
}

/** Our own R2 origin + path prefix — i.e. an object that will still be there. */
function isOurR2Url(url: string): boolean {
  if (!config.R2_PUBLIC_URL) return false
  try {
    const base = new URL(config.R2_PUBLIC_URL)
    const candidate = new URL(url)
    if (candidate.origin !== base.origin) return false
    const prefix = base.pathname.endsWith("/") ? base.pathname : `${base.pathname}/`
    return candidate.pathname.startsWith(prefix)
  } catch {
    return false
  }
}

/**
 * Produced-media keys are deterministic (`videos/<jobId>.<ext>`), so a
 * deliverable URL names its own job with no extra lookup table.
 */
const JOB_VIDEO_KEY =
  /^videos\/([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})\.[A-Za-z0-9]+$/

function jobIdFromDeliverableUrl(url: string): string | undefined {
  if (!isOurR2Url(url)) return undefined
  try {
    const base = new URL(config.R2_PUBLIC_URL)
    const prefix = base.pathname.endsWith("/") ? base.pathname : `${base.pathname}/`
    const key = new URL(url).pathname.slice(prefix.length)
    return JOB_VIDEO_KEY.exec(key)?.[1]
  } catch {
    return undefined
  }
}

/**
 * The PREVIOUS extension's raw mov, when this extend is continuing a clip we
 * ourselves produced on the 2.5 mov path.
 *
 * Why it matters: the `@video_1` reference is normally cut out of the
 * stitched deliverable with ffmpeg, which re-encodes it to 4:2:0 — throwing
 * away exactly the colour fidelity `output_format: "mov"` was requested for.
 * If the source IS a job of ours whose raw extension we kept as a `.mov`
 * object, the reference is cut from that object instead
 * ({@link cutChainedMovTail}), which keeps the whole chain in yuv444p.
 *
 * EVERY failure is silent and falls back to the tail: a foreign source URL, a
 * URL that is not a job-keyed deliverable, a job that is not the caller's, an
 * mp4 raw extension, a KIE temp URL (long expired by the next extend), or a
 * database error. The tail transport is what works today; this only ever
 * upgrades it.
 */
export async function findChainedMovReference(
  sourceUrl: string,
  userId: string | undefined,
): Promise<string | undefined> {
  // No owner ⇒ no ownership-scoped query we are willing to run: fall back.
  if (!userId) return undefined
  const jobId = jobIdFromDeliverableUrl(sourceUrl)
  if (!jobId) return undefined
  try {
    const { data } = await supabase
      .from("jobs")
      .select("output_data")
      .eq("id", jobId)
      // Scoped to the caller: never chain off another user's stored object.
      .eq("user_id", userId)
      .maybeSingle()
    const raw = (data?.output_data as { rawExtensionUrl?: unknown } | null | undefined)?.rawExtensionUrl
    if (typeof raw !== "string") return undefined
    return isMovUrl(raw) && isOurR2Url(raw) ? raw : undefined
  } catch (err) {
    console.warn(`[seedance-extend] chained mov lookup failed for job ${jobId}:`, err)
    return undefined
  }
}

/** How much shorter than `coverSec` a chained mov's picture may read and still cover it: a millisecond of rounding. */
const CHAINED_MOV_COVER_TOLERANCE_SEC = 0.001

/**
 * The last `seconds` of the PICTURE of the raw mov at `movUrl` (from
 * {@link findChainedMovReference}), as a local `.mov` in `workDir`: the
 * `@video_1` reference a chained extend sends in place of the tail it cuts
 * from the stitched deliverable: the same last seconds of picture (the
 * extension is joined at the deliverable's end untrimmed), in their own
 * container.
 *
 * The cut keeps what the mov was requested for, by the same rules a reference
 * video's re-encode follows (`providers/kie/reference-video-reencode.ts`): the
 * picture at the source's own bitrate in two passes (a visually lossless
 * constant quality when the bitrate is unreadable), its pixel format (4:4:4
 * stays 4:4:4) and colour tags; the sound copied when a MOV holds it as it is
 * (its PCM), else AAC. Measured from the picture's end (`getVideoStreamDuration`),
 * since the sound may run past the last frame. A copied sound is held to the
 * cut (`-copypriorss 0`): input seeking starts each stream at the keyframe
 * before the cut, and a copied stream would otherwise keep that pre-roll.
 *
 * `coverSec`: the seconds the cut must hold — what the run sends (and is
 * priced for), the source's last seconds. A mov whose picture is shorter (the
 * previous extension added fewer seconds than are sent) cannot stand in for
 * them, and is refused before anything is cut.
 *
 * Throws when the clip cannot be fetched or cut, or is shorter than
 * `coverSec`; the caller falls back to the tail.
 */
export async function cutChainedMovTail(movUrl: string, seconds: number, workDir: string, opts: { coverSec?: number } = {}): Promise<string> {
  const input = join(workDir, "chain-source.mov")
  const output = join(workDir, "chain-tail.mov")
  await downloadFile(movUrl, input)
  const probe = await probeReferenceVideo(input)
  const pictureSec = await getVideoStreamDuration(input)
  if (opts.coverSec !== undefined && pictureSec + CHAINED_MOV_COVER_TOLERANCE_SEC < opts.coverSec) {
    throw new Error(`chained mov holds ${pictureSec.toFixed(3)}s of picture, less than the ${opts.coverSec.toFixed(3)}s the run sends`)
  }
  const start = Math.max(0, pictureSec - seconds)
  // The cut's own length: its bitrate and size limit are the cut's, not the whole clip's.
  const cut: ReferenceVideoProbe = { ...probe, durationSec: Math.min(seconds, pictureSec) }
  // A chained mov is a Seedance 2.5 extension, and so is the run it is cut for.
  const maxBytes = SEEDANCE_2_5_REF_VIDEO_MAX_BYTES
  const passLog = referenceVideoTargetBitRate(cut, maxBytes) ? join(workDir, "chain-tail-pass") : undefined
  const window = ["-ss", start.toFixed(3), "-i", input, "-t", String(seconds)]
  // Admitted like every ffmpeg, at the clip's own size (unknown = assumed 4K).
  const launch = {
    peakMemoryMiB: reencodePeakMemoryMiB(probe.width && probe.height ? { width: probe.width, height: probe.height } : undefined),
  }
  if (passLog) {
    await runFfmpeg(
      ["-y", ...window, "-map", "0:v:0", "-an", ...referenceVideoPictureArgs(cut, maxBytes, { n: 1, log: passLog }), "-f", "null", "-"],
      undefined,
      launch,
    )
  }
  const audio = referenceVideoAudio(probe, "mov")
  await runFfmpeg(
    [
      "-y", ...window,
      "-map", "0:v:0", "-map", "0:a:0?",
      "-map_metadata", "-1", "-map_chapters", "-1",
      ...referenceVideoPictureArgs(cut, maxBytes, passLog ? { n: 2, log: passLog } : undefined),
      ...(audio === "copy" ? ["-c:a", "copy", "-copypriorss", "0"] : ["-c:a", "aac", "-b:a", "192k"]),
      "-movflags", "+faststart",
      output,
    ],
    undefined,
    launch,
  )
  return output
}
