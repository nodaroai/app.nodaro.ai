/**
 * Split into Chunks (`split-media`): a video or a sound file cut into parts of
 * at most x seconds (`chunkDuration`) and at least the minimum
 * (`minPartDuration`) — exactly, never over. The plan, the refusals and the
 * budgets are pure and live in `split-media-plan.ts`; this file runs ffmpeg.
 *
 * VIDEO (decided 2026-10-12, measured on ffmpeg 9.0.2; see the e2e test):
 *  1. ONE decode of the source, two outputs: the picture re-encoded at a
 *     CONSTANT frame rate (the probed rate as a fraction, `fps=num/den` — VFR
 *     sources become frame-countable) with keyframes forced at every frame a
 *     cut can land on, and the sound as raw float PCM aligned to the picture's
 *     first frame (`aresample=async=1:first_pts=P`).
 *  2. The real frame count (packet count of that file) → the partition → the
 *     picture is cut at those frame indices by STREAM COPY (`-segment_frames`):
 *     every cut is a keyframe, so every part has exactly its planned frames.
 *  3. Each part's sound: the samples under its picture
 *     (`audioSamplesForFrames`), from the first, rounded DOWN to whole AAC
 *     frames (`aacWholeFrameSamples` — the pinned ffmpeg decodes AAC-in-MP4 to
 *     whole frames, so any other length decodes past the picture there), read
 *     from the PCM at its byte offset (no re-read from the start, however late
 *     the part) and encoded once into the part, its edit list in samples.
 * Why not one pass straight into the segment muxer: it cuts the SOUND at AAC
 * packet boundaries — measured, parts came out 35–63 ms short and the last
 * part's sound ran past its picture.
 *
 * AUDIO: decoded once to PCM, each part encoded from its sample range (see
 * `AUDIO_FORMATS`). Decoded length per container (measured, 144 500 samples
 * in): WAV and MP3 (ffmpeg writes the LAME gapless header) exact; AAC in ADTS
 * (`.aac`) 146 432 — 1 024 priming samples plus padding to a whole frame, which
 * ADTS cannot signal — so the "aac" format writes AAC in MP4 (`.m4a`) instead.
 */
// @reads-none lists only the parts ffmpeg writes into its work dir
import { promises as fs } from "node:fs"
import { join } from "node:path"
import { DeterministicJobError } from "../../lib/deterministic-job-error.js"
import {
  BIG_MEDIA_DOWNLOAD_LIMITS,
  cleanupWorkDir,
  createWorkDir,
  downloadFile,
  runFfmpeg,
  runFfprobe,
} from "./ffmpeg-utils.js"
import { audioPeakMemoryMiB, cameraMegapixelsOf, canvasPeakMemoryMiB, UHD_CANVAS } from "./ffmpeg-memory-model.js"
import { ffmpegEffectiveThreads } from "./ffmpeg-threads.js"
import {
  AAC_FRAME_SAMPLES,
  aacWholeFrameSamples,
  audioSamplesForFrames,
  cutPointsOf,
  forcedKeyframeTimes,
  keyframeCandidates,
  maxPartMsOf,
  maxSourceSecFor,
  maxSourceUnits,
  minPartMsOf,
  overCapOfUnknownLength,
  sourceTooLongMessage,
  planSplit,
  SPLIT_MEDIA_MAX_PARTS,
  splitCopyTimeoutMs,
  splitEncodeTimeoutMs,
  splitPartTimeoutMs,
  splitSettingsOf,
  unitRate,
  unitsAtLeast,
  unitsAtMost,
  unitsNearest,
  unitsToSec,
  type SplitMediaKind,
  type UnitRate,
} from "./split-media-plan.js"

export * from "./split-media-plan.js"
export { SPLIT_MEDIA_DEFAULT_MIN_PART_SEC } from "@nodaro/render-rules"

export interface SplitMediaOptions {
  readonly videoUrl?: string
  readonly audioUrl?: string
  readonly chunkDuration: number
  /** Seconds; absent → `splitMediaMinPartSec`'s default (4 s, never above x). */
  readonly minPartDuration?: number
  readonly audioFormat?: "mp3" | "wav" | "aac"
}

export interface SplitMediaResult {
  /** The directory every part lives in; the caller removes it once uploaded. */
  readonly workDir: string
  /** In part order. */
  readonly videoPaths?: string[]
  readonly audioPaths?: string[]
  /** Each video part's exact length: frames · den / num. */
  readonly videoPartDurationsSec?: number[]
  /** Each audio part's exact length: samples / rate. */
  readonly audioPartDurationsSec?: number[]
}

/** The picture-rate ceiling a probed rate must stay under to be believed:
 *  above it, `r_frame_rate` is a timebase (90000/1, 1000/1), not a cadence. */
export const MAX_SPLIT_FPS = 240

/** A ffprobe rational ("30000/1001", "25/1", "25") as a reduced fraction, or undefined. */
export function parseRate(value: unknown): UnitRate | undefined {
  if (typeof value !== "string") return undefined
  const m = /^\s*(\d+)(?:\/(\d+))?\s*$/.exec(value)
  if (!m) return undefined
  const num = Number(m[1])
  const den = m[2] === undefined ? 1 : Number(m[2])
  if (!Number.isSafeInteger(num) || !Number.isSafeInteger(den) || num <= 0 || den <= 0) return undefined
  return unitRate(num, den)
}

const believable = (r: UnitRate | undefined): r is UnitRate => r !== undefined && r.num / r.den <= MAX_SPLIT_FPS

/**
 * The constant rate the picture is normalised to: the stream's nominal rate
 * (`r_frame_rate`, the capture cadence — 30000/1001, 25/1) when it is a
 * believable frame rate, else its average, else 30/1. Nominal first because a
 * variable-rate source then only gains held frames, never loses motion.
 */
export function pickSplitFrameRate(nominal: unknown, average: unknown): UnitRate {
  const r = parseRate(nominal)
  if (believable(r)) return r
  const a = parseRate(average)
  if (believable(a)) return a
  return unitRate(30, 1)
}

interface ProbedStream {
  readonly index: number
  readonly codec_type?: string
  readonly r_frame_rate?: string
  readonly avg_frame_rate?: string
  readonly start_time?: string
  readonly duration?: string
  readonly width?: number
  readonly height?: number
  readonly sample_rate?: string
  readonly channels?: number
  readonly channel_layout?: string
  readonly disposition?: { readonly attached_pic?: number }
}

interface ProbedFile {
  readonly streams: readonly ProbedStream[]
  readonly format: { readonly start_time?: string; readonly duration?: string }
}

const num = (v: string | undefined): number | undefined => {
  const n = v === undefined ? NaN : Number(v)
  return Number.isFinite(n) ? n : undefined
}

/** One JSON probe of a local file (JSON, not CSV: no duplicated TS rows, no trailing side-data fields). */
export async function probeSplitSource(path: string): Promise<ProbedFile> {
  const out = await runFfprobe([
    "-v", "error",
    "-show_entries",
    "format=start_time,duration:stream=index,codec_type,r_frame_rate,avg_frame_rate,start_time,duration,width,height,sample_rate,channels,channel_layout:stream_disposition=attached_pic",
    "-of", "json",
    path,
  ])
  const parsed = JSON.parse(out) as Partial<ProbedFile>
  return { streams: Array.isArray(parsed.streams) ? parsed.streams : [], format: parsed.format ?? {} }
}

/** The first real picture stream (cover art is a "video" stream too). */
const videoStreamOf = (p: ProbedFile) => p.streams.find((s) => s.codec_type === "video" && s.disposition?.attached_pic !== 1)
const audioStreamOf = (p: ProbedFile) => p.streams.find((s) => s.codec_type === "audio")

/** How a raw PCM file's layout is told to ffmpeg, on write and on read alike. */
interface PcmFormat {
  readonly sampleRate: number
  readonly channels: number
  /** `-ch_layout <name>` when the probe named one, else `-ac <count>`. */
  readonly layoutArgs: readonly string[]
}

const PCM_BYTES_PER_SAMPLE = 4 // f32le

function pcmFormatOf(stream: ProbedStream): PcmFormat | undefined {
  const sampleRate = Number(stream.sample_rate)
  const channels = stream.channels ?? 0
  if (!Number.isSafeInteger(sampleRate) || sampleRate <= 0 || !Number.isSafeInteger(channels) || channels <= 0) return undefined
  const layout = stream.channel_layout?.trim()
  const layoutArgs = layout && layout !== "unknown" ? ["-ch_layout", layout] : ["-ac", String(channels)]
  return { sampleRate, channels, layoutArgs }
}

const pcmOutputArgs = (pcm: PcmFormat): string[] => ["-c:a", "pcm_f32le", "-ar", String(pcm.sampleRate), ...pcm.layoutArgs, "-f", "f32le"]

/** Input args that read `length` samples of the PCM from sample `start` — by
 *  byte offset, so a late part never re-reads the file from its start. Past
 *  the PCM's end it is padded with silence to exactly `length`. */
function pcmPartInputArgs(pcmPath: string, pcm: PcmFormat, start: number): string[] {
  return [
    "-f", "f32le", "-ar", String(pcm.sampleRate), ...pcm.layoutArgs,
    "-skip_initial_bytes", String(start * pcm.channels * PCM_BYTES_PER_SAMPLE),
    "-i", pcmPath,
  ]
}
const pcmPartFilter = (length: number): string => `apad=whole_len=${length},atrim=end_sample=${length}`

async function pcmSampleCount(path: string, pcm: PcmFormat): Promise<number> {
  const { size } = await fs.stat(path)
  return Math.floor(size / (pcm.channels * PCM_BYTES_PER_SAMPLE))
}

const LOG_ARGS = ["-y", "-nostats", "-loglevel", "error"] as const

function refuse(message: string): never {
  throw new DeterministicJobError(message)
}

function planOrRefuse(kind: SplitMediaKind, total: number, rate: UnitRate, chunkSec: number, minPartSec: number): number[] {
  const verdict = planSplit(kind, total, rate, chunkSec, minPartSec)
  if (!verdict.ok) refuse(verdict.message)
  return verdict.parts
}

/** The packets (= frames, one per packet for H.264 in MP4) of a file's video stream. */
async function countVideoFrames(path: string): Promise<number> {
  const out = await runFfprobe(["-v", "error", "-select_streams", "v:0", "-count_packets", "-show_entries", "stream=nb_read_packets", "-of", "json", path])
  const n = Number((JSON.parse(out) as { streams?: Array<{ nb_read_packets?: string }> }).streams?.[0]?.nb_read_packets)
  if (!Number.isSafeInteger(n) || n < 0) throw new Error(`split-media: could not count the frames of ${path}`)
  return n
}

/** Part files in part order: `<prefix>-00000.<ext>` …, never a lexical sort. */
const partPath = (dir: string, prefix: string, i: number, ext: string) => join(dir, `${prefix}-${String(i).padStart(5, "0")}.${ext}`)

async function assertPartFiles(dir: string, prefix: string, ext: string, count: number): Promise<void> {
  const names = (await fs.readdir(dir)).filter((f) => f.startsWith(`${prefix}-`))
  for (let i = 0; i < count; i++) {
    if (!names.includes(`${prefix}-${String(i).padStart(5, "0")}.${ext}`)) throw new Error(`split-media: part ${i + 1} of ${count} was not written`)
  }
  if (names.length !== count) throw new Error(`split-media: expected ${count} parts, ffmpeg wrote ${names.length}`)
}

async function splitVideo(
  inputPath: string,
  workDir: string,
  chunkSec: number,
  minPartSec: number,
): Promise<{ paths: string[]; durationsSec: number[] }> {
  const probe = await probeSplitSource(inputPath)
  const video = videoStreamOf(probe)
  if (!video) refuse("This file has no video stream to split. Connect it to the audio input instead.")
  const fps = pickSplitFrameRate(video.r_frame_rate, video.avg_frame_rate)
  const formatStart = num(probe.format.start_time) ?? 0
  const videoStart = Math.max(0, (num(video.start_time) ?? formatStart) - formatStart)
  const formatSec = num(probe.format.duration)
  const probedSec = num(video.duration) ?? (formatSec === undefined ? undefined : formatSec - videoStart)
  // A file written to a pipe (MediaRecorder WebM, a streamed Matroska) states no
  // length at all: then nothing is refused before the encode, the encode stops
  // one frame past the cap, and the real count decides.
  const knownSec = probedSec !== undefined && probedSec > 0 ? probedSec : undefined

  const maxUnits = unitsAtMost(maxPartMsOf(chunkSec), fps)
  const minUnits = unitsAtLeast(minPartMsOf(minPartSec), fps)
  if (maxUnits < 1) planOrRefuse("video", 1, fps, chunkSec, minPartSec) // a part shorter than a frame
  const frameCap = SPLIT_MEDIA_MAX_PARTS * maxUnits
  const sourceFrameCap = maxSourceUnits(fps)
  // Refuse BEFORE the encode on the probe's estimate; the real count decides below.
  const estimate = knownSec === undefined ? undefined : unitsNearest(knownSec * 1000, fps)
  if (estimate !== undefined && estimate > sourceFrameCap) refuse(sourceTooLongMessage("video", knownSec))
  if (estimate !== undefined) planOrRefuse("video", estimate, fps, chunkSec, minPartSec)
  const sourceSec = videoStart + (knownSec ?? maxSourceSecFor(chunkSec))

  const audio = audioStreamOf(probe)
  const pcm = audio ? pcmFormatOf(audio) : undefined
  const pcmPath = join(workDir, "audio.pcm")
  // The picture's first frame sits at round(videoStart · fps) on the grid; the
  // PCM starts at that same instant (padded with silence or trimmed).
  const firstFrame = unitsNearest(videoStart * 1000, fps)
  const firstSample = pcm ? audioSamplesForFrames(firstFrame, firstFrame, fps, pcm.sampleRate).start : 0

  const canvas = { width: video.width ?? UHD_CANVAS.width, height: video.height ?? UHD_CANVAS.height }
  const encodeLaunch = {
    peakMemoryMiB: canvasPeakMemoryMiB(canvas, 1, ffmpegEffectiveThreads(), { inputs: 1, cameraMegapixels: cameraMegapixelsOf(canvas) }),
  }
  const encodeTimeoutMs = splitEncodeTimeoutMs(sourceSec, { ...canvas, fps: fps.num / fps.den })
  const cfrPath = join(workDir, "picture-cfr.mp4")
  const encode = async (keyframes: readonly number[], withSound: boolean) => {
    await runFfmpeg([
      ...LOG_ARGS, "-i", inputPath,
      "-map", `0:${video.index}`,
      "-vf", `fps=fps=${fps.num}/${fps.den}`,
      "-c:v", "libx264", "-preset", "fast", "-crf", "23",
      "-force_key_frames", forcedKeyframeTimes(keyframes, fps),
      ...(estimate === undefined ? ["-frames:v", String(Math.min(frameCap, sourceFrameCap) + 1)] : []),
      cfrPath,
      ...(withSound && audio && pcm
        ? ["-map", `0:${audio.index}`, "-af", `aresample=async=1:first_pts=${firstSample}`, ...pcmOutputArgs(pcm), pcmPath]
        : []),
    ], encodeTimeoutMs, encodeLaunch)
    return countVideoFrames(cfrPath)
  }

  // No estimate: key every multiple of the part length — every cut but a
  // rebalanced tail's — and let the fallback below handle the tail.
  let keyed = estimate !== undefined
    ? keyframeCandidates(estimate, maxUnits, minUnits)
    : Array.from({ length: SPLIT_MEDIA_MAX_PARTS }, (_, i) => i * maxUnits)
  let frames = await encode(keyed, true)
  if (frames > sourceFrameCap) refuse(sourceTooLongMessage("video", estimate === undefined ? undefined : unitsToSec(frames, fps)))
  if (estimate === undefined && frames > frameCap) refuse(overCapOfUnknownLength("video", chunkSec))
  let parts = planOrRefuse("video", frames, fps, chunkSec, minPartSec)
  let cuts = cutPointsOf(parts)
  if (cuts.slice(0, -1).some((c) => !keyed.includes(c))) {
    // The picture came out further from the estimate than its slack: encode
    // again with keyframes at exactly this partition's cuts (same source, same
    // filter → the same frames).
    console.warn(`[splitMedia] ${frames} frames vs an estimate of ${estimate ?? "none"}; re-encoding with the exact cuts`)
    keyed = cuts.slice(0, -1)
    const again = await encode(keyed, false)
    if (again !== frames) throw new Error(`split-media: the re-encode made ${again} frames, the first ${frames}`)
    frames = again
    parts = planOrRefuse("video", frames, fps, chunkSec, minPartSec)
    cuts = cutPointsOf(parts)
  }

  const segPrefix = "picture-part"
  if (parts.length === 1) {
    await fs.rename(cfrPath, partPath(workDir, segPrefix, 0, "mp4"))
  } else {
    await runFfmpeg([
      ...LOG_ARGS, "-i", cfrPath,
      "-map", "0:v", "-c", "copy",
      "-f", "segment", "-segment_format", "mp4",
      "-segment_frames", cuts.slice(1, -1).join(","),
      "-reset_timestamps", "1",
      join(workDir, `${segPrefix}-%05d.mp4`),
    ], splitCopyTimeoutMs(sourceSec), { peakMemoryMiB: audioPeakMemoryMiB() })
    await fs.rm(cfrPath, { force: true })
  }
  await assertPartFiles(workDir, segPrefix, "mp4", parts.length)

  const paths: string[] = []
  for (let i = 0; i < parts.length; i++) {
    const picture = partPath(workDir, segPrefix, i, "mp4")
    const out = partPath(workDir, "video-part", i, "mp4")
    const partSec = unitsToSec(parts[i]!, fps)
    // Its sound: the samples under its picture, from the first, in whole AAC
    // frames (`aacWholeFrameSamples` — never past the picture on any decoder).
    const window = audio && pcm ? audioSamplesForFrames(cuts[i]!, cuts[i + 1]!, fps, pcm.sampleRate) : undefined
    const soundSamples = window ? aacWholeFrameSamples(window.end - window.start) : 0
    if (pcm && window && soundSamples > 0) {
      await runFfmpeg([
        ...LOG_ARGS, "-i", picture, ...pcmPartInputArgs(pcmPath, pcm, window.start),
        "-map", "0:v:0", "-map", "1:a:0",
        "-c:v", "copy",
        "-af", pcmPartFilter(soundSamples),
        "-c:a", "aac", "-b:a", "128k",
        // The edit list in sample units: at the default 1 ms movie timescale a
        // spec decoder reads up to 47 samples short of what was written.
        "-movie_timescale", String(pcm.sampleRate),
        "-movflags", "+faststart",
        out,
      ], splitPartTimeoutMs(partSec), { peakMemoryMiB: audioPeakMemoryMiB() })
    } else {
      await runFfmpeg([...LOG_ARGS, "-i", picture, "-map", "0:v:0", "-c", "copy", "-movflags", "+faststart", out],
        splitPartTimeoutMs(partSec), { peakMemoryMiB: audioPeakMemoryMiB() })
    }
    await fs.rm(picture, { force: true })
    paths.push(out)
  }
  await fs.rm(pcmPath, { force: true })
  return { paths, durationsSec: parts.map((p) => unitsToSec(p, fps)) }
}

/**
 * Each audio-only format: the encoder, the file it writes, and the UNIT its
 * parts are counted in.
 *  - wav, mp3: one sample — both decode to exactly the samples written (MP3
 *    through ffmpeg's LAME gapless header).
 *  - aac: AAC in MP4 (`.m4a`, decided 2026-10-12; ADTS `.aac` cannot signal the
 *    encoder's priming and decoded 1 024+ samples long). The pinned ffmpeg
 *    decodes AAC-in-MP4 to whole 1 024-sample frames (it ignores the edit
 *    list's end), so N samples decode to ⌈N / 1024⌉ · 1024 there — over x. The
 *    parts are therefore planned in whole AAC FRAMES: every part is a multiple
 *    of 1 024 samples and decodes to exactly that on every decoder, the
 *    partition stays contiguous and within [min, x], and only the file's last
 *    < 1 024 samples (under 21 ms at 48 kHz) are not in any part.
 */
const AUDIO_FORMATS = {
  mp3: { ext: "mp3", codec: ["-c:a", "libmp3lame"], unitSamples: 1 },
  wav: { ext: "wav", codec: ["-c:a", "pcm_s16le"], unitSamples: 1 },
  aac: { ext: "m4a", codec: ["-c:a", "aac"], unitSamples: AAC_FRAME_SAMPLES },
} as const

async function splitAudio(
  inputPath: string,
  workDir: string,
  chunkSec: number,
  minPartSec: number,
  audioFormat: "mp3" | "wav" | "aac",
): Promise<{ paths: string[]; durationsSec: number[] }> {
  const probe = await probeSplitSource(inputPath)
  const audio = audioStreamOf(probe)
  const pcm = audio ? pcmFormatOf(audio) : undefined
  if (!audio || !pcm) refuse("This file has no audio stream to split.")
  const format = AUDIO_FORMATS[audioFormat]
  const unit = format.unitSamples
  // Units per second as a fraction: samples (sr / 1) or AAC frames (sr / 1024).
  const rate = unitRate(pcm.sampleRate, unit)
  const probedSec = num(audio.duration) ?? num(probe.format.duration)
  const knownSec = probedSec !== undefined && probedSec > 0 ? probedSec : undefined
  const maxUnits = unitsAtMost(maxPartMsOf(chunkSec), rate)
  const sampleCap = SPLIT_MEDIA_MAX_PARTS * maxUnits * unit
  const sourceSampleCap = maxSourceUnits(unitRate(pcm.sampleRate, 1))
  // Refuse before decoding on the probe's length; with none stated (a piped
  // file), the decode stops one sample past the caps and the real count decides.
  if (knownSec !== undefined && unitsNearest(knownSec * 1000, unitRate(pcm.sampleRate, 1)) > sourceSampleCap) {
    refuse(sourceTooLongMessage("audio", knownSec))
  }
  if (knownSec !== undefined) planOrRefuse("audio", unitsNearest(knownSec * 1000, rate), rate, chunkSec, minPartSec)

  const pcmPath = join(workDir, "audio.pcm")
  await runFfmpeg([
    ...LOG_ARGS, "-i", inputPath, "-map", `0:${audio.index}`,
    ...(knownSec === undefined ? ["-af", `atrim=end_sample=${Math.min(sampleCap, sourceSampleCap) + 1}`] : []),
    ...pcmOutputArgs(pcm), pcmPath,
  ], splitCopyTimeoutMs(knownSec ?? maxSourceSecFor(chunkSec)), { peakMemoryMiB: audioPeakMemoryMiB() })
  const samples = await pcmSampleCount(pcmPath, pcm)
  if (samples > sourceSampleCap) refuse(sourceTooLongMessage("audio", knownSec === undefined ? undefined : samples / pcm.sampleRate))
  if (knownSec === undefined && samples > sampleCap) refuse(overCapOfUnknownLength("audio", chunkSec))
  const parts = planOrRefuse("audio", Math.floor(samples / unit), rate, chunkSec, minPartSec)
  const cuts = cutPointsOf(parts)

  const paths: string[] = []
  for (let i = 0; i < parts.length; i++) {
    const out = partPath(workDir, "audio-part", i, format.ext)
    const length = parts[i]! * unit
    await runFfmpeg([
      ...LOG_ARGS, ...pcmPartInputArgs(pcmPath, pcm, cuts[i]! * unit),
      "-af", pcmPartFilter(length),
      ...format.codec,
      // MP4: the edit list in sample units (at the default 1 ms movie timescale
      // a spec decoder reads up to 47 samples short), the index up front.
      ...(format.ext === "m4a" ? ["-movie_timescale", String(pcm.sampleRate), "-movflags", "+faststart"] : []),
      out,
    ], splitPartTimeoutMs(unitsToSec(parts[i]!, rate)), { peakMemoryMiB: audioPeakMemoryMiB() })
    paths.push(out)
  }
  await fs.rm(pcmPath, { force: true })
  return { paths, durationsSec: parts.map((p) => unitsToSec(p, rate)) }
}

export async function splitMedia(options: SplitMediaOptions): Promise<SplitMediaResult> {
  const { videoUrl, audioUrl, audioFormat = "mp3" } = options
  const settings = splitSettingsOf(options)
  if (!settings) refuse("The part length must be a positive number of seconds.")
  const { chunkSec, minPartSec } = settings
  const workDir = await createWorkDir("split-media")
  try {
    let video: { paths: string[]; durationsSec: number[] } | undefined
    let sound: { paths: string[]; durationsSec: number[] } | undefined
    if (videoUrl) {
      const inputPath = join(workDir, "input-video")
      console.log("[splitMedia] Downloading video")
      await downloadFile(videoUrl, inputPath, { limits: BIG_MEDIA_DOWNLOAD_LIMITS })
      video = await splitVideo(inputPath, workDir, chunkSec, minPartSec)
      await fs.rm(inputPath, { force: true })
    }
    if (audioUrl) {
      const inputPath = join(workDir, "input-audio")
      console.log("[splitMedia] Downloading audio")
      await downloadFile(audioUrl, inputPath, { limits: BIG_MEDIA_DOWNLOAD_LIMITS })
      sound = await splitAudio(inputPath, workDir, chunkSec, minPartSec, audioFormat)
      await fs.rm(inputPath, { force: true })
    }
    return {
      workDir,
      videoPaths: video?.paths,
      audioPaths: sound?.paths,
      videoPartDurationsSec: video?.durationsSec,
      audioPartDurationsSec: sound?.durationsSec,
    }
  } catch (err) {
    await cleanupWorkDir(workDir)
    throw err
  }
}
