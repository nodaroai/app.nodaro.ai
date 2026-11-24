/**
 * The delivery of a Topaz Rhea run (the `topaz-rhea` provider, and Nodaro
 * Video Upscale's transparent mode): the engine's file brought to the frame
 * the run promised, then stored like every other upscale.
 *
 * The engine rounds the output's sides its own way and, at some sizes, pads
 * black rows below the picture (a 480×854 clip at 1.5× came back 720×1284 with
 * the picture in the top 1281 rows). The run planned its frame up front
 * (`rheaExpectedFrame`: the source × the factor, each side even). Here:
 *
 * - the frame matches → the file is kept as delivered (no re-encode);
 * - the file is LARGER on a side → cropped to the planned frame from the top
 *   left (where the engine puts the picture), in ONE H.264 encode at the
 *   engine file's own video bitrate (capped at {@link MAX_CROP_BITRATE}, at
 *   least {@link MIN_CROP_BITRATE}), its sound copied;
 * - the file is SMALLER on a side → kept on that side (never stretched), and
 *   logged;
 * - the engine dropped the sound and the source has some → the source's sound
 *   is laid back on (the picture copied when no crop is needed).
 *
 * One function for the worker and the reconcile, so a recovered run is
 * delivered exactly as a live one.
 */
import { join } from "node:path"
import { createWorkDir, cleanupWorkDir, downloadFile, hasAudioStream, runFfmpeg, runFfprobe } from "../providers/video/ffmpeg-utils.js"
import { runPostProcessing } from "./post-processing-error.js"
import { DeterministicJobError } from "./deterministic-job-error.js"
import { guardedPacketScan, videoTrackLengthFrom } from "./video-track-length.js"

/** The frame the run promised. */
export interface RheaFrame {
  readonly width: number
  readonly height: number
}

/** The crop's encode bitrate bounds (bits per second). */
export const MIN_CROP_BITRATE = 8_000_000
export const MAX_CROP_BITRATE = 80_000_000
/** The rate used when the engine's file states none. */
const FALLBACK_CROP_BITRATE = 30_000_000

/** What the engine delivered, as read from its file. */
interface DeliveredFile {
  readonly width: number
  readonly height: number
  /** Its video stream's length in seconds, when stated. */
  readonly durationSec?: number
  /** The file's length in seconds (`format=duration`), when stated. */
  readonly containerSec?: number
  /** Its video stream's index, for a packet scan. */
  readonly streamIndex?: number
  /** The file's start time (`format=start_time`), taken off a packet end. */
  readonly startTimeSec?: number
  /** Its video stream's bitrate (else the file's), bits per second, when stated. */
  readonly bitrate?: number
}

/** A positive finite number read from an ffprobe field ("N/A", absent or zero: undefined). */
function positive(v: unknown): number | undefined {
  const n = Number(v)
  return Number.isFinite(n) && n > 0 ? n : undefined
}

async function probeDelivered(path: string): Promise<DeliveredFile> {
  const out = await runFfprobe([
    "-v", "error",
    "-select_streams", "v:0",
    "-show_entries", "stream=index,width,height,bit_rate,duration:format=bit_rate,duration,start_time",
    "-of", "json",
    path,
  ])
  const parsed = JSON.parse(out) as { streams?: Array<{ index?: number; width?: number; height?: number; bit_rate?: string; duration?: string }>; format?: { bit_rate?: string; duration?: string; start_time?: string } }
  const stream = parsed.streams?.[0]
  const width = Number(stream?.width)
  const height = Number(stream?.height)
  if (!(width > 0) || !(height > 0)) throw new Error("the upscaled file has no readable frame size")
  // Each field read on its own: a stream that states "N/A" still leaves the file's.
  const rate = positive(stream?.bit_rate) ?? positive(parsed.format?.bit_rate)
  const streamSec = positive(stream?.duration)
  const containerSec = positive(parsed.format?.duration)
  const startTime = Number(parsed.format?.start_time)
  return {
    width,
    height,
    ...(rate !== undefined ? { bitrate: rate } : {}),
    ...(streamSec !== undefined ? { durationSec: streamSec } : {}),
    ...(containerSec !== undefined ? { containerSec } : {}),
    ...(typeof stream?.index === "number" ? { streamIndex: stream.index } : {}),
    ...(Number.isFinite(startTime) ? { startTimeSec: startTime } : {}),
  }
}

/**
 * The engine file's picture length, in seconds: its video stream's, else its
 * packets' (scanned only when the stream states none), else the file's — the
 * bound a laid-back sound is cut at. Undefined only when none of the three is
 * readable (then the padded sound ends at the picture through `-shortest`).
 */
async function pictureSecOf(path: string, file: DeliveredFile): Promise<number | undefined> {
  if (file.durationSec !== undefined) return file.durationSec
  const length = await videoTrackLengthFrom(
    {
      ...(file.streamIndex !== undefined ? { streamIndex: file.streamIndex } : {}),
      ...(file.startTimeSec !== undefined ? { startTimeSec: file.startTimeSec } : {}),
      ...(file.containerSec !== undefined ? { containerSec: file.containerSec } : {}),
    },
    guardedPacketScan(path),
  )
  return length?.sec
}

/** The crop a delivered frame needs to become `expected` (never stretched: a smaller side is kept), or undefined when none. */
export function rheaCropFor(delivered: RheaFrame, planned: RheaFrame): RheaFrame | undefined {
  // A source stored turned (a rotation tag) can come back in the other
  // orientation: the plan is read the way the file is, never cropped across.
  const turned = delivered.width !== delivered.height && planned.width !== planned.height &&
    (delivered.width > delivered.height) !== (planned.width > planned.height)
  const expected = turned ? { width: planned.height, height: planned.width } : planned
  const width = Math.min(delivered.width, expected.width)
  const height = Math.min(delivered.height, expected.height)
  return width < delivered.width || height < delivered.height ? { width, height } : undefined
}

/** The crop encode's video bitrate: the engine file's, within the bounds. */
export function rheaCropBitrate(engineBitrate: number | undefined): number {
  return Math.min(MAX_CROP_BITRATE, Math.max(MIN_CROP_BITRATE, engineBitrate ?? FALLBACK_CROP_BITRATE))
}

/** The ffmpeg arguments that crop and/or lay the source's sound back (exported for its tests). */
export function rheaFitArgs(opts: {
  input: string
  output: string
  crop?: RheaFrame
  bitrate: number
  /** The source file to take the sound from, when the engine's file has none. */
  soundFrom?: string
  /** The engine file's picture length (seconds): the output is capped at it when sound is laid on. */
  pictureSec?: number
}): string[] {
  const args = ["-y", "-i", opts.input]
  if (opts.soundFrom) args.push("-i", opts.soundFrom)
  args.push("-map", "0:v:0")
  if (opts.crop) {
    const b = opts.bitrate
    args.push(
      "-vf", `crop=${opts.crop.width}:${opts.crop.height}:0:0`,
      "-c:v", "libx264", "-preset", "slow", "-profile:v", "high", "-pix_fmt", "yuv420p",
      "-b:v", String(b), "-maxrate", String(Math.round(b * 1.5)), "-bufsize", String(b * 2),
    )
  } else {
    args.push("-c:v", "copy")
  }
  // The source's sound laid back on: padded with silence when it is shorter
  // than the picture, and the file capped at the picture's length — never the
  // picture cut to a shorter sound. The length is read from the stream, its
  // packets or the file (`pictureSecOf`); only a file that states none of the
  // three ends at the shorter stream, which with the sound padded is the
  // picture.
  if (opts.soundFrom) args.push("-map", "1:a:0", "-af", "apad", "-c:a", "aac", "-b:a", "192k", ...(opts.pictureSec !== undefined ? ["-t", String(opts.pictureSec)] : ["-shortest"]))
  else args.push("-map", "0:a?", "-c:a", "copy")
  args.push("-movflags", "+faststart", opts.output)
  return args
}

/** What a delivery stored, and the frame of the file it stored (probed from that file). */
export interface RheaDelivered<T> {
  readonly stored: T
  readonly width: number
  readonly height: number
}

/**
 * The file could not be brought to its frame (its probe or the crop's encode
 * failed on the file itself): the same file fails again, so it is FINAL — the
 * reconcile fails and refunds it at its first look instead of retrying.
 */
function finalFitFailure(step: string, err: unknown): DeterministicJobError {
  return new DeterministicJobError(`The upscaled video could not be prepared (${step}).`, { cause: err })
}

/**
 * Bring the engine's file at `outputUrl` to `expected` (see the module note)
 * and hand the local result to `store` (the caller's watermark + upload). The
 * returned frame is PROBED from the file handed to `store`. Post-provider: a
 * failure here is a PostProcessingError (the run was billed); one on the file
 * itself (its probe, the crop) is also final ({@link finalFitFailure}).
 */
export async function deliverRheaOutput<T>(opts: {
  outputUrl: string
  expected: RheaFrame
  /** The clip that was upscaled: its sound is laid back on when the engine dropped it. */
  sourceUrl?: string
  jobId: string
  store: (localPath: string) => Promise<T>
}): Promise<RheaDelivered<T>> {
  return runPostProcessing(async () => {
    const dir = await createWorkDir("rhea-fit")
    try {
      const input = join(dir, "engine.mp4")
      await downloadFile(opts.outputUrl, input)
      const delivered = await probeDelivered(input).catch((err: unknown) => { throw finalFitFailure("probe", err) })
      const crop = rheaCropFor(delivered, opts.expected)
      if (delivered.width * delivered.height < opts.expected.width * opts.expected.height) {
        console.warn(`[rhea-delivery] job ${opts.jobId}: delivered ${delivered.width}×${delivered.height}, planned ${opts.expected.width}×${opts.expected.height}; kept the smaller side`)
      }
      let soundFrom: string | undefined
      if (opts.sourceUrl && !(await hasAudioStream(input))) {
        const source = join(dir, "source.mp4")
        await downloadFile(opts.sourceUrl, source)
        if (await hasAudioStream(source)) soundFrom = source
      }
      if (!crop && !soundFrom) {
        return { stored: await opts.store(input), width: delivered.width, height: delivered.height }
      }
      const output = join(dir, "fitted.mp4")
      // The picture's length bounds a laid-back sound (read only when one is laid on).
      const pictureSec = soundFrom ? await pictureSecOf(input, delivered) : undefined
      await runFfmpeg(rheaFitArgs({
        input,
        output,
        ...(crop ? { crop } : {}),
        bitrate: rheaCropBitrate(delivered.bitrate),
        ...(soundFrom ? { soundFrom } : {}),
        ...(pictureSec !== undefined ? { pictureSec } : {}),
      })).catch((err: unknown) => {
        if ((err as { timedOut?: unknown; killed?: unknown } | null)?.timedOut === true) throw err
        throw finalFitFailure(crop ? "crop" : "sound", err)
      })
      const fitted = await probeDelivered(output).catch((err: unknown) => { throw finalFitFailure("probe", err) })
      console.log(`[rhea-delivery] job ${opts.jobId}: ${crop ? `cropped ${delivered.width}×${delivered.height} → ${fitted.width}×${fitted.height}` : "frame kept"}${soundFrom ? ", the source's sound laid back on" : ""}`)
      return { stored: await opts.store(output), width: fitted.width, height: fitted.height }
    } finally {
      await cleanupWorkDir(dir)
    }
  })
}
