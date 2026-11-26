/**
 * The browser-safe PREVIEW of a video whose own file a browser may not play
 * (decided 2026-11-22): what `videoUrl` names when the provider's file is kept
 * beside it as the original (`lib/video-result-store.ts`).
 *
 * The rule keys on the PROBED file, never on a model or provider: a picture
 * that is not H.264 in yuv420p (`videoStreamNeedsTranscode`) is encoded to
 * 8-bit H.264 yuv420p.
 *
 * - An HDR picture (transfer `arib-std-b67` HLG or `smpte2084` PQ, `isHdr`)
 *   is tone-mapped to SDR BT.709 first, by the extend stitch's own chain
 *   (`deliveredPictureFilter` → `toSdr`), and tagged BT.709. Without it the
 *   picture was squeezed into 8 bits still tagged HLG/PQ, which most browsers
 *   show washed out or too dark.
 * - A 10-bit (or 4:2:2 / 4:4:4) SDR picture is taken plainly to 8-bit 4:2:0,
 *   its colour tags kept; a full-range one to limited range.
 * - An odd-sized picture is cropped to even sides (4:2:0 needs them).
 *
 * Quality: CRF 23 by default, or the caller's (an upscale keeps 18).
 *
 * Memory and time are sized for the picture it is (a 4K HDR preview holds far
 * more than the default launch estimate): see `previewPeakMemoryMiB` and
 * `previewTimeoutMs`.
 */
import { DEFAULT_FFMPEG_TIMEOUT_MS } from "./ffmpeg-timeouts.js"
import { runFfmpeg, runFfprobe, videoStreamNeedsTranscode } from "./ffmpeg-utils.js"
import { toolRefusedInput } from "./ffmpeg-input-verdict.js"
import { deliveredPictureFilter, isHdr } from "./extend-stitch-args.js"
import { cameraMegapixelsOf, canvasPeakMemoryMiB, UHD_CANVAS } from "./ffmpeg-memory-model.js"
import { ffmpegEffectiveThreads } from "./ffmpeg-threads.js"
import { probeMatched, type MatchedProbe } from "./matched-encode.js"

/**
 * Whether the browser-safe step would change this file: its picture is not
 * H.264 in yuv420p, an unread codec or format included (`videoStreamNeedsTranscode`).
 * The ONE test of whether a provider's file is kept as the original.
 */
export function previewChangesFile(probe: MatchedProbe): boolean {
  return videoStreamNeedsTranscode({ codec: probe.videoCodec ?? "", pixFmt: probe.pixFmt ?? "" })
}

/**
 * Encode the preview of `input` (probed as `probe`) to `output`, admitted at
 * its own memory prediction and held to its own time limit. `signal` (the
 * job's cancel or the worker's drain) stops it waiting for its slot AND stops
 * it once it runs; the encode then rejects with the signal's reason.
 *
 * A preview with no video frame in it (a file whose header reads but whose
 * picture does not decode: ffmpeg can exit 0 having written none) is a
 * failure, never a stored result (decided 2026-11-22).
 */
export async function encodeBrowserSafePreview(input: string, output: string, probe: MatchedProbe, crf?: string, signal?: AbortSignal): Promise<string> {
  try {
    await runFfmpeg(previewEncodeArgs(input, output, probe, crf), previewTimeoutMs(probe), {
      peakMemoryMiB: previewPeakMemoryMiB(probe),
      ...(signal ? { signal, stopOnAbort: true } : {}),
    })
  } catch (err) {
    if (signal?.aborted) throw signal.reason ?? err
    throw err
  }
  const check = await decodedVideoFrames(output, 1)
  if (check.kind === "none") {
    throw Object.assign(new Error("[browser-safe-preview] the preview has no video frame: the source's picture does not decode"), { noVideoFrame: true as const })
  }
  if (check.kind === "unknown") {
    // The check itself could not run (the machine's failure): retried like any other, never read as "no frame".
    throw new Error("[browser-safe-preview] the preview's frames could not be counted", { cause: check.cause })
  }
  return output
}

/** How many of a file's first frames a check decodes before it is trusted as a picture. */
export const DECODE_CHECK_FRAMES = 5

/**
 * What a frame count came to (decided 2026-11-23): `frames` decoded; `none` —
 * ffprobe RAN and answered that no frame decodes (a clean exit with no frame,
 * or its own invalid-data refusal); `unknown` — it could not tell (it did not
 * start, ran out of time, was killed, or the machine was short of threads or
 * memory). Only `none` may ever condemn a file.
 */
export type FrameCount = { readonly kind: "frames"; readonly n: number } | { readonly kind: "none" } | { readonly kind: "unknown"; readonly cause: unknown }

/**
 * Whether an ffprobe failure is ffprobe answering that the file cannot be
 * used: it ran to its own end (never killed, timed out, stopped or unstarted)
 * and its output names the input as invalid (`toolRefusedInput`, a positive
 * rule). Any other failure is the machine's: could not tell.
 */
function probeAnswered(err: unknown): boolean {
  const flags = (err ?? {}) as { killed?: unknown; timedOut?: unknown; notStarted?: unknown; aborted?: unknown; truncated?: unknown; signalledFromOutside?: unknown; message?: unknown }
  if (flags.killed !== false) return false
  if (flags.timedOut === true || flags.notStarted === true || flags.aborted === true || flags.truncated === true || flags.signalledFromOutside === true) return false
  return toolRefusedInput(typeof flags.message === "string" ? flags.message : undefined)
}

/** How many of `path`'s first `frames` video frames decode (ffprobe decodes them; nothing is written). */
export async function decodedVideoFrames(path: string, frames: number = DECODE_CHECK_FRAMES): Promise<FrameCount> {
  try {
    const out = await runFfprobe([
      "-v", "error", "-select_streams", "v:0", "-count_frames", "-read_intervals", `%+#${frames}`,
      "-show_entries", "stream=nb_read_frames", "-of", "csv=p=0", path,
    ])
    const n = Number.parseInt(out.trim().split(/\s+/)[0] ?? "", 10)
    return Number.isFinite(n) && n > 0 ? { kind: "frames", n } : { kind: "none" }
  } catch (err) {
    return probeAnswered(err) ? { kind: "none" } : { kind: "unknown", cause: err }
  }
}

/**
 * Whether `path` (probed as `probe`) is a picture that decodes: sides above
 * zero, and its first `DECODE_CHECK_FRAMES` frames — or, in a shorter clip,
 * every frame it holds — decode. The test before an original is kept (decided
 * 2026-11-22): a file that fails it ("no") is stored the old way, never kept.
 * "unknown" when a check could not run: the caller retries, never condemns. A
 * short clip's frames are counted from its packets, never from a header field
 * (a WebM or Matroska file carries none).
 */
export async function pictureDecodes(path: string, probe: MatchedProbe): Promise<"yes" | "no" | { readonly unknown: unknown }> {
  if (!(Number(probe.width) > 0 && Number(probe.height) > 0)) return "no"
  const decoded = await decodedVideoFrames(path, DECODE_CHECK_FRAMES)
  if (decoded.kind === "unknown") return { unknown: decoded.cause }
  if (decoded.kind === "none") return "no"
  if (decoded.n >= DECODE_CHECK_FRAMES) return "yes"
  // A clip shorter than the check: every frame it holds must decode.
  const packets = await videoPacketCount(path)
  if (packets === undefined) return { unknown: new Error("the clip's frames could not be counted") }
  return packets > 0 && decoded.n >= packets ? "yes" : "no"
}

/** How many video packets (frames) the file holds, counted by reading them (no decode), or undefined when it cannot be read. */
async function videoPacketCount(path: string): Promise<number | undefined> {
  try {
    const out = await runFfprobe(["-v", "error", "-select_streams", "v:0", "-count_packets", "-show_entries", "stream=nb_read_packets", "-of", "csv=p=0", path])
    const n = Number.parseInt(out.trim(), 10)
    return Number.isFinite(n) ? n : undefined
  } catch {
    return undefined
  }
}

/**
 * The browser-safe copy of a local file: the file itself when the browser-safe
 * step would not change it, else its preview at `output`. For a caller that
 * keeps no original (a watermark-free plugin encode).
 */
export async function browserSafeCopy(input: string, output: string, crf?: string): Promise<string> {
  const probe = await probeMatched(input)
  if (!previewChangesFile(probe)) return input
  return encodeBrowserSafePreview(input, output, probe, crf)
}

/** The preview's constant quality unless the caller names one (x264's default, as the browser-safe step has always used). */
export const PREVIEW_DEFAULT_CRF = "23"

/** The colour tags of a tone-mapped preview: SDR BT.709, limited range. */
const SDR_PREVIEW_TAGS = ["-color_primaries", "bt709", "-color_trc", "bt709", "-colorspace", "bt709", "-color_range", "tv"] as const

/** A colour tag the probe really read: not absent, "unknown" or "reserved". */
const readTag = (tag: string | undefined): string | undefined => (tag && tag !== "unknown" && tag !== "reserved" ? tag : undefined)

/** Whether the probe says the picture is full range (`pc`, or a `yuvj` format). */
const isFullRange = (probe: MatchedProbe): boolean => readTag(probe.colorRange) === "pc" || Boolean(probe.pixFmt?.startsWith("yuvj"))

/**
 * The colour tags the preview is written with: SDR BT.709 for a tone-mapped
 * picture; otherwise the source's own as the probe read them (limited range
 * for a full-range source, whose levels the filter converted), and none it did
 * not read.
 */
function previewColourTags(probe: MatchedProbe): string[] {
  if (isHdr(probe)) return [...SDR_PREVIEW_TAGS]
  const tag = (flag: string, v: string | undefined) => (v ? [flag, v] : [])
  return [
    ...tag("-color_primaries", readTag(probe.colorPrimaries)),
    ...tag("-color_trc", readTag(probe.colorTransfer)),
    ...tag("-colorspace", readTag(probe.colorSpace)),
    ...tag("-color_range", isFullRange(probe) ? "tv" : readTag(probe.colorRange)),
  ]
}

/**
 * The ffmpeg arguments of the preview encode of `input` (probed as `probe`)
 * to `output`: the picture as the module header sets out, the sound as AAC
 * 128k (as the browser-safe step has always written it).
 */
export function previewEncodeArgs(input: string, output: string, probe: MatchedProbe, crf: string = PREVIEW_DEFAULT_CRF): string[] {
  const filter = deliveredPictureFilter(probe)
  return [
    // Errors only, and no progress line: a long encode of a damaged picture
    // logs per frame, and a capture buffer it outgrows ends the launch.
    "-v", "error", "-nostats",
    "-y", "-i", input,
    ...(filter ? ["-vf", filter] : []),
    "-c:v", "libx264", "-pix_fmt", "yuv420p", "-preset", "fast", "-crf", crf,
    ...previewColourTags(probe),
    "-movflags", "+faststart",
    "-c:a", "aac", "-b:a", "128k",
    output,
  ]
}

/** The picture size the preview is sized for: the probe's, else 4K (the largest a provider delivers today). */
function previewCanvas(probe: MatchedProbe): { width: number; height: number } {
  return probe.width && probe.height ? { width: probe.width, height: probe.height } : UHD_CANVAS
}

/**
 * The preview launch's predicted peak memory (MiB): the canvas model for one
 * segment of one input at the picture's own size, with the tone-map's float
 * frames when the picture is HDR. Measured on the pinned build (arm64, 4 s
 * clips): a 4K 10-bit SDR preview peaked at 1,436 MiB at 2 threads and 2,021 at
 * 8 (the model: 1,642 and 2,192); a 4K tone-mapped one at 1,827 and 2,440 (the
 * model: 2,239 and 2,789). The default estimate a launch with no prediction
 * reserves (~300 MiB at few threads) is a fraction of that.
 */
export function previewPeakMemoryMiB(probe: MatchedProbe): number {
  const canvas = previewCanvas(probe)
  return canvasPeakMemoryMiB(canvas, 1, ffmpegEffectiveThreads(), {
    inputs: 1,
    cameraMegapixels: cameraMegapixelsOf(canvas),
    toneMap: isHdr(probe),
  })
}

/** Wall seconds the preview is allowed per second of 4K picture. Measured on the pinned build: 3.35 s at 2 threads for a tone-mapped 4K clip; 15 leaves room for a slower or busier box. */
export const PREVIEW_SEC_PER_4K_SEC = 15

/** The longest a preview encode is ever given: 30 minutes. */
export const PREVIEW_MAX_TIMEOUT_MS = 30 * 60 * 1000

/**
 * How long the preview encode may run: `PREVIEW_SEC_PER_4K_SEC` per second of
 * picture, scaled by its size against 4K, never below the default ffmpeg
 * ceiling (10 minutes) and never above `PREVIEW_MAX_TIMEOUT_MS`. A picture whose
 * length the probe did not read gets the maximum. A preview that runs out of
 * time does not lose the run: the job completes on the original
 * (`lib/video-result-store.ts`).
 */
export function previewTimeoutMs(probe: MatchedProbe): number {
  const seconds = probe.videoDurationSec ?? probe.durationSec
  if (seconds === undefined || !(seconds > 0)) return PREVIEW_MAX_TIMEOUT_MS
  const canvas = previewCanvas(probe)
  const scale = (canvas.width * canvas.height) / (UHD_CANVAS.width * UHD_CANVAS.height)
  const wanted = Math.ceil(seconds * PREVIEW_SEC_PER_4K_SEC * scale * 1000)
  return Math.min(PREVIEW_MAX_TIMEOUT_MS, Math.max(DEFAULT_FFMPEG_TIMEOUT_MS, wanted))
}
