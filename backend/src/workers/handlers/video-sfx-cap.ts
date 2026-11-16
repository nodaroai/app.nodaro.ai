/**
 * Video SFX's length cap on the file it sends.
 *
 * A clip up to 0.05 s past the 300-second cap is accepted at the top row (the
 * charge's grace, `measureVideoSfxDuration`) and the model is asked to score
 * 300 seconds. The file itself is cut to the cap here, before it is sent, so
 * the model never receives more than the run paid for.
 *
 * Only a run asked for the cap can hold such a file, so only that run is
 * measured again: the container's length, read as the charge read it
 * (`probeClipLengthSec`). A file at or under the cap is sent as it is. A
 * longer one is downloaded, cut to its first 300 seconds with its streams
 * copied (no re-encode, so the picture the model returns is the source's), and
 * re-hosted in the job's scratch folder.
 *
 * Best-effort, as the AI Avatar audio cap is: a probe or cut that fails is
 * logged and the original link is sent, which is what a run sent before (a
 * file at most 0.05 s past the cap, already charged the top row).
 */
import { extname, join } from "node:path"
import { VIDEO_SFX_PRICING } from "@nodaro/shared/credits"
import { BIG_MEDIA_DOWNLOAD_LIMITS, cleanupWorkDir, createWorkDir, downloadFile, runFfmpeg } from "../../providers/video/ffmpeg-utils.js"
import { DOWNLOAD_TIMEOUT_MS } from "../../providers/video/ffmpeg-timeouts.js"
import { uploadJobScratchFile } from "../../lib/job-scratch.js"
import { PRE_CHARGE_PROBE_TIMEOUT_MS } from "../../lib/pre-charge-probe-bounds.js"
import { probeClipLengthSec } from "../../lib/video-utility-probe.js"

/** The containers a cut keeps (its streams are copied, so it stays in the source's own); anything else is cut to an MP4. */
const VIDEO_MIME: Record<string, string> = {
  ".mp4": "video/mp4",
  ".m4v": "video/mp4",
  ".mov": "video/quicktime",
  ".webm": "video/webm",
  ".mkv": "video/x-matroska",
}

function containerOf(url: string): string {
  let path = url
  try {
    path = new URL(url).pathname
  } catch {
    // a local path: its own extension
  }
  const ext = extname(path).toLowerCase()
  return VIDEO_MIME[ext] ? ext : ".mp4"
}

/**
 * The link to send the model: `videoUrl` as it is, unless the run was asked
 * for the cap (`durationSeconds`) and its file runs past it — then the file
 * cut to the cap, in the job's scratch folder.
 */
export async function capVideoSfxSource(videoUrl: string, durationSeconds: number, jobId: string): Promise<string> {
  const cap = VIDEO_SFX_PRICING.MAX_DURATION_SEC
  if (!(durationSeconds >= cap)) return videoUrl
  try {
    const seconds = await probeClipLengthSec(videoUrl, { reading: "container", timeoutMs: PRE_CHARGE_PROBE_TIMEOUT_MS, packetTimeoutMs: DOWNLOAD_TIMEOUT_MS })
    if (!(seconds > cap)) return videoUrl
    const workDir = await createWorkDir("video-sfx-cap")
    try {
      const ext = containerOf(videoUrl)
      const inPath = join(workDir, `in${ext}`)
      const outPath = join(workDir, `out${ext}`)
      // Big-media limits: a 5-minute clip can be gigabytes, past the flat default download bound.
      await downloadFile(videoUrl, inPath, { limits: BIG_MEDIA_DOWNLOAD_LIMITS })
      // Its first `cap` seconds: the picture and any sound, copied as they are.
      await runFfmpeg(["-y", "-i", inPath, "-t", String(cap), "-map", "0:v:0", "-map", "0:a?", "-c", "copy", outPath])
      const cutUrl = await uploadJobScratchFile(outPath, "video-sfx-cap", ext.slice(1), VIDEO_MIME[ext]!, jobId)
      console.log(`[worker] video-sfx ${jobId}: clip ${seconds.toFixed(3)}s > ${cap}s cap — cut to ${cap}s before it is sent`)
      return cutUrl
    } finally {
      await cleanupWorkDir(workDir)
    }
  } catch (err) {
    console.error(`[worker] video-sfx ${jobId}: the cap cut failed (sending the original, at most a hair past ${cap}s):`, err)
    return videoUrl
  }
}
