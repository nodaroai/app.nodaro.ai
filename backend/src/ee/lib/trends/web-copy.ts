// @reads-none reads only temp files: the video it downloads and the web copy it makes from it
/**
 * A shown trend video's WEB copy (types.ts `TrendWebCopy`): one light MP4 the
 * platform makes once, so clients can play the original and every example
 * as it is, on every screen, with no CDN transform.
 *
 * WHY. A trend's display copy and examples are stored near their source
 * quality (a 21 s 720×1280 display copy is ~27 MB: H.264 ~10 Mbit/s), which
 * freezes when streamed on a phone; the CDN's light copies are light in
 * picture but always re-encode the sound to AAC 64 kbit/s, with no option
 * for more. The web copy is light in picture (H.264 at CRF 23, capped near
 * 3 Mbit/s: ~2.5 Mbit/s on such a clip) and keeps the sound full (AAC
 * 160 kbit/s stereo), so the same 21 s clip is ~7 MB.
 *
 * Not the delivery CRF (`COMBINE_DELIVERY_CRF`, 18): that one is for the one
 * file a person downloads, where generation loss matters more than weight;
 * this copy exists to be light, and its source stays stored as it is.
 *
 * WHEN. In the background right after a publish (`startWebCopies`), for the
 * version just published, and by the backfill
 * (`scripts/backfill-trend-web-copies.ts`) for versions published before:
 * publish is the one step every shown video passes through (an upload, a
 * crop, an upscale, a promoted example), and only published versions are
 * shown. A publish never waits for them and never fails for them: until a
 * video's copy is attached the public answer carries no `webUrl` for it, and
 * clients play it as before. A copy made for a published version is carried
 * to the next draft (examples are server-owned; the display copy's is kept
 * by the draft save), so a republish copies only what changed.
 */
import { mkdtemp, rm, stat } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { downloadFile, probeAudioSampleRate, probeVideoSource, runFfmpeg } from "../../../providers/video/ffmpeg-utils.js"
import { reencodePeakMemoryMiB } from "../../../providers/video/video-file-stages.js"
import { uploadFileWithKeyToR2 } from "../../../lib/storage.js"
import { isTransientMediaFailure, TREND_MEDIA_MAX_BYTES, TrendMediaError, trendMediaKey } from "./media.js"
import { attachWebCopies, type WebCopyAttachResult } from "./store.js"
import type { TrendVersionData, TrendWebCopy } from "./types.js"
import { webCopyTargets, type WebCopyTarget } from "./web-copy-plan.js"

/** The web copy's short side at most: a larger video is scaled down to it, a smaller one kept as it is. */
export const WEB_COPY_SHORT_SIDE_MAX = 1080

/** The web copy's sound: AAC at this bitrate, stereo. */
export const WEB_COPY_AUDIO_BITRATE = "160k"

/** One web copy's encode is given up after this long (preset medium is slower than the platform's usual "fast"). */
export const WEB_COPY_TIMEOUT_MS = 10 * 60_000

/** The sample rate the web copy's sound is written at: the source's when it is 44.1 or 48 kHz, else 48 kHz. */
export function webCopyAudioRate(sourceRate: number | undefined): 44100 | 48000 {
  return sourceRate === 44100 ? 44100 : 48000
}

/**
 * The ffmpeg arguments that make `input`'s web copy at `out`: its first
 * picture and first sound track only (no metadata, chapters, data or
 * subtitles); the picture H.264 High / yuv420p at CRF 23 capped at 3 Mbit/s
 * (6 Mbit buffer), preset medium, at its own size when its short side is at
 * most 1080, else scaled to 1080 on the short side (aspect kept), with even
 * sides either way (yuv420p needs them; a phone clip can have an odd one).
 * The short side is read from the DECODED frame, so a rotated phone clip is
 * judged the way it is shown. The sound AAC 160 kbit/s stereo at
 * `audioRate`; `+faststart`, so playback starts before the file is in.
 */
export function webCopyArgs(input: string, out: string, opts: { audioRate: 44100 | 48000 }): string[] {
  const max = WEB_COPY_SHORT_SIDE_MAX
  // The short side kept (at most `max`, even); the long side `-2`: the aspect kept, rounded to even.
  const w = `'if(lte(iw,ih),trunc(min(iw,${max})/2)*2,-2)'`
  const h = `'if(lte(iw,ih),-2,trunc(min(ih,${max})/2)*2)'`
  return [
    "-y", "-i", input,
    "-map", "0:v:0", "-map", "0:a:0?",
    "-map_metadata", "-1", "-map_chapters", "-1",
    "-vf", `scale=w=${w}:h=${h},setsar=1`,
    "-c:v", "libx264", "-preset", "medium", "-crf", "23", "-maxrate", "3M", "-bufsize", "6M",
    "-profile:v", "high", "-pix_fmt", "yuv420p",
    "-c:a", "aac", "-b:a", WEB_COPY_AUDIO_BITRATE, "-ac", "2", "-ar", String(opts.audioRate),
    "-movflags", "+faststart",
    out,
  ]
}

/** A web copy as made, before it is pinned to the entry it stands for. */
export interface MadeWebCopy {
  videoUrl: string
  sizeBytes: number
}

/**
 * Download `fromUrl` (SSRF-guarded, within the trend video limit), make its
 * web copy (`webCopyArgs`) and upload it under `trends/<trendId>/<uuid>.mp4`.
 * The encode is `runFfmpeg` (its own ffmpeg slot), admitted at the video's
 * probed size. Throws `TrendMediaError` ("download_failed" /
 * "media_unreadable", the ffmpeg failure as its cause) before anything is
 * stored; a launch the platform killed or could not admit
 * (`isTransientMediaFailure`) and a storage failure are thrown as they are.
 */
export async function makeWebCopy(trendId: string, fromUrl: string): Promise<MadeWebCopy> {
  const dir = await mkdtemp(join(tmpdir(), "trend-web-"))
  const input = join(dir, "input")
  const out = join(dir, "web.mp4")
  try {
    try {
      await downloadFile(fromUrl, input, { maxBytes: TREND_MEDIA_MAX_BYTES.video })
    } catch (e) {
      throw new TrendMediaError("download_failed", `Could not fetch the video: ${e instanceof Error ? e.message : String(e)}`)
    }
    try {
      const probe = await probeVideoSource(input)
      const audioRate = webCopyAudioRate(await probeAudioSampleRate(input))
      await runFfmpeg(webCopyArgs(input, out, { audioRate }), WEB_COPY_TIMEOUT_MS, {
        peakMemoryMiB: reencodePeakMemoryMiB({ width: probe.width, height: probe.height }),
      })
    } catch (e) {
      if (isTransientMediaFailure(e)) throw e
      throw new TrendMediaError("media_unreadable", "Could not make a web copy of the video.", { cause: e })
    }
    const { size } = await stat(out)
    const videoUrl = await uploadFileWithKeyToR2(out, trendMediaKey(trendId, "mp4"), "video/mp4")
    return { videoUrl, sizeBytes: size }
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined)
  }
}

/** One target's outcome: its copy, or why it could not be made. */
export interface WebCopyOutcome {
  target: WebCopyTarget
  copy?: TrendWebCopy
  error?: unknown
}

export interface WebCopiesResult {
  outcomes: WebCopyOutcome[]
  /** What the attach did; absent when nothing was made. */
  attached?: WebCopyAttachResult
}

/**
 * Make a web copy of every video `data` (version `version` of the trend)
 * shows that has none (`webCopyTargets`), one at a time, and attach the ones
 * made (`attachWebCopies`). A video whose copy fails is left without (its
 * outcome carries the error) and never stops the others; `onEach` is told
 * of each outcome as it lands. Throws only what the attach throws.
 */
export async function makeWebCopies(
  trendId: string,
  version: number,
  data: TrendVersionData,
  opts: { make?: typeof makeWebCopy; onEach?: (o: WebCopyOutcome) => void } = {},
): Promise<WebCopiesResult> {
  const make = opts.make ?? makeWebCopy
  const outcomes: WebCopyOutcome[] = []
  for (const target of webCopyTargets(data)) {
    let outcome: WebCopyOutcome
    try {
      const made = await make(trendId, target.encodeFrom)
      outcome = { target, copy: { ...made, madeFrom: target.madeFrom } }
    } catch (error) {
      outcome = { target, error }
    }
    outcomes.push(outcome)
    opts.onEach?.(outcome)
  }
  const copies = outcomes.flatMap((o) => (o.copy ? [o.copy] : []))
  if (copies.length === 0) return { outcomes }
  return { outcomes, attached: await attachWebCopies(trendId, version, copies) }
}

/** The versions whose web copies are being made in this process (`<trendId>:<version>`): a second publish does not start them again. */
const inFlight = new Set<string>()

interface WebCopyLog {
  info(obj: object, msg: string): void
  warn(obj: object, msg: string): void
}

/**
 * Start `makeWebCopies` for a version just published, in the background:
 * returns at once, never throws, and never reaches the publish. Every
 * failure is logged; a version already in the making here is not started
 * twice. Returns the work's promise (for tests); callers do not await it.
 */
export function startWebCopies(
  trendId: string,
  version: number,
  data: TrendVersionData,
  log: WebCopyLog,
  opts: { make?: typeof makeWebCopy } = {},
): Promise<void> {
  const key = `${trendId}:${version}`
  if (inFlight.has(key)) return Promise.resolve()
  try {
    if (webCopyTargets(data).length === 0) return Promise.resolve()
  } catch {
    return Promise.resolve()
  }
  inFlight.add(key)
  return makeWebCopies(trendId, version, data, {
    ...(opts.make ? { make: opts.make } : {}),
    onEach: (o) => {
      if (o.error !== undefined) {
        const err = o.error instanceof TrendMediaError ? (o.error.cause ?? o.error) : o.error
        log.warn({ err, trendId, version, video: o.target.label }, "trends: a web copy could not be made")
      }
    },
  })
    .then((r) => {
      if (r.attached) log.info({ trendId, version, ...r.attached }, "trends: web copies attached")
    })
    .catch((err: unknown) => {
      log.warn({ err, trendId, version }, "trends: web copies could not be attached")
    })
    .finally(() => {
      inFlight.delete(key)
    })
}
