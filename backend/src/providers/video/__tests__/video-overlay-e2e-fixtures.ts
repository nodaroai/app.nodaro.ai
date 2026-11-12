// backend/src/providers/video/__tests__/video-overlay-e2e-fixtures.ts
/**
 * Real-ffmpeg + sharp fixture builders and frame readers for the Video Overlay
 * e2e suites: `video-overlay-pinned-ffmpeg.e2e.test.ts` (the D1 chain written
 * out by hand — the confirmation that the production ffmpeg pin does what the
 * spec relies on) and `video-overlay.e2e.test.ts` (the provider end to end).
 * Not a test file (vitest collects only `*.test.ts`).
 *
 * Every fixture is generated at run time (lavfi / sharp) — no binaries in git.
 * Geometry cases draw on a FLAT grey base, so "where did the layer land" is the
 * bounding box of every pixel that is no longer grey.
 */
import { execFile, execFileSync } from "node:child_process"
import { promisify } from "node:util"
import sharp from "sharp"
import { runFfmpeg, runFfmpegCapture, runFfprobe } from "../ffmpeg-utils.js"

const execFileP = promisify(execFile)

function commandOutput(cmd: string, args: string[]): string | null {
  try {
    return execFileSync(cmd, args, { stdio: ["ignore", "pipe", "ignore"] }).toString()
  } catch {
    return null
  }
}

export const ffmpegAvailable = commandOutput("ffmpeg", ["-version"]) !== null
export const libopusAvailable = ffmpegAvailable && (commandOutput("ffmpeg", ["-hide_banner", "-encoders"]) ?? "").includes("libopus")

export const FPS = 30
export type Rgb = readonly [number, number, number]
/** The flat base colour (0x404040) every geometry case draws on. */
export const BASE_RGB: Rgb = [64, 64, 64]

/** First line of `ffmpeg -version` — the pinned smoke asserts it carries the Dockerfile's pin in CI. */
export function ffmpegVersionLine(): string {
  return (commandOutput("ffmpeg", ["-version"]) ?? "").split("\n", 1)[0] ?? ""
}

export interface BaseOptions {
  readonly width: number
  readonly height: number
  readonly durationSec: number
  /** Default "aac". */
  readonly audio?: "aac" | "opus" | "none"
  /** Stored sample aspect ratio, e.g. "2/1" (display width = width × sar). */
  readonly sar?: string
}

/** A flat-grey H.264 clip at 30 fps, optionally with a 440 Hz tone. */
export async function makeBase(path: string, o: BaseOptions): Promise<void> {
  const audio = o.audio ?? "aac"
  await runFfmpeg([
    "-y",
    "-f", "lavfi", "-i", `color=c=0x404040:size=${o.width}x${o.height}:rate=${FPS}:duration=${o.durationSec}`,
    ...(audio === "none" ? [] : ["-f", "lavfi", "-i", `sine=frequency=440:sample_rate=48000:duration=${o.durationSec}`]),
    ...(o.sar ? ["-vf", `setsar=${o.sar}`] : []),
    "-c:v", "libx264", "-pix_fmt", "yuv420p",
    ...(audio === "none" ? [] : ["-c:a", audio === "opus" ? "libopus" : "aac", "-shortest"]),
    path,
  ])
}

const hex = (rgb: Rgb): string => `0x${rgb.map((c) => c.toString(16).padStart(2, "0")).join("")}`

export interface ClipOptions {
  readonly width: number
  readonly height: number
  /** Each colour fills `secondsEach`, in order — one colour is a flat clip. */
  readonly colours: readonly Rgb[]
  readonly secondsEach: number
  /** Default 30. */
  readonly fps?: number
  /** Default "none". */
  readonly audio?: "aac" | "none"
}

/** A video layer's source: flat colours one after another, H.264, optionally with a 660 Hz tone. */
export async function makeColourClip(path: string, o: ClipOptions): Promise<void> {
  const fps = o.fps ?? FPS
  const total = o.colours.length * o.secondsEach
  const inputs = o.colours.flatMap((c) => ["-f", "lavfi", "-i", `color=c=${hex(c)}:size=${o.width}x${o.height}:rate=${fps}:duration=${o.secondsEach}`])
  const n = o.colours.length
  const concat = n > 1 ? ["-filter_complex", `${o.colours.map((_, i) => `[${i}:v]`).join("")}concat=n=${n}:v=1[v]`, "-map", "[v]"] : []
  const withAudio = o.audio === "aac"
  await runFfmpeg([
    "-y",
    ...inputs,
    ...(withAudio ? ["-f", "lavfi", "-i", `sine=frequency=660:sample_rate=48000:duration=${total}`] : []),
    ...concat,
    ...(withAudio ? (n > 1 ? ["-map", `${n}:a`] : []) : []),
    "-c:v", "libx264", "-pix_fmt", "yuv420p",
    ...(withAudio ? ["-c:a", "aac", "-shortest"] : []),
    path,
  ])
}

/** A clip whose LEFT half is one colour and RIGHT half another — rotated, the halves become top and bottom; squashed, they stay side by side. */
export async function makeSplitClip(path: string, o: { width: number; height: number; left: Rgb; right: Rgb; durationSec: number }): Promise<void> {
  const half = `size=${o.width / 2}x${o.height}:rate=${FPS}:duration=${o.durationSec}`
  await runFfmpeg([
    "-y",
    "-f", "lavfi", "-i", `color=c=${hex(o.left)}:${half}`,
    "-f", "lavfi", "-i", `color=c=${hex(o.right)}:${half}`,
    "-filter_complex", "[0:v][1:v]hstack[v]", "-map", "[v]",
    "-c:v", "libx264", "-pix_fmt", "yuv420p",
    path,
  ])
}

/**
 * A 2 s 160×90 black clip that flashes white at 1.0–1.2 s, silent but for a
 * 1 kHz beep at the same instant, H.264 with B-frames (`-bf 2`) + AAC. Muxed
 * without an edit list, its picture starts 2 frames (0.067 s) after its sound
 * in the file — in sync on a player, which plays both from the earlier start.
 */
export async function makeFlashBeepClip(path: string, o: { readonly editList: boolean }): Promise<void> {
  await runFfmpeg([
    "-y",
    "-f", "lavfi", "-i", `color=c=black:size=160x90:rate=${FPS}:duration=2,drawbox=x=0:y=0:w=iw:h=ih:color=white:t=fill:enable='between(t,1,1.2)'`,
    "-f", "lavfi", "-i", "sine=frequency=1000:sample_rate=48000:duration=2,volume=enable='not(between(t,1,1.2))':volume=0",
    "-c:v", "libx264", "-bf", "2", "-pix_fmt", "yuv420p", "-c:a", "aac",
    ...(o.editList ? [] : ["-use_editlist", "0"]),
    path,
  ])
}

/**
 * When a player shows the flash and plays the beep: both read on ONE clock,
 * the timestamps ffmpeg decodes (`pts_time`), as a player does — never by
 * counting frames or samples, which would close a gap a track carries (an MP4
 * without an edit list stretches its first audio packet over the picture's
 * late start). `beepSampleTimeSec` is the sample-count reading, for that gap.
 */
/** The `pts_time` of the first frame whose `crop` is bright (mean luma over 128) — the flash. Null when none is. */
export async function flashTimeSec(path: string, crop: { left: number; top: number; width: number; height: number }): Promise<number | null> {
  const { stderr } = await runFfmpegCapture([
    "-hide_banner", "-i", path, "-map", "0:v:0",
    "-vf", `crop=${crop.width}:${crop.height}:${crop.left}:${crop.top},signalstats,metadata=print:key=lavfi.signalstats.YAVG`,
    "-f", "null", "-",
  ])
  let at: number | null = null
  for (const line of stderr.split("\n")) {
    const t = /\bpts_time:(-?[\d.]+)/.exec(line)
    if (t) at = Number(t[1])
    const y = /lavfi\.signalstats\.YAVG=([\d.]+)/.exec(line)
    if (y && at !== null && Number(y[1]) > 128) return at
  }
  return null
}

/** The `pts_time` the first silence ends at — the beep's onset (−30 dB, 50 ms). Null for a silent track. */
export async function beepTimeSec(path: string): Promise<number | null> {
  const { stderr } = await runFfmpegCapture(["-hide_banner", "-i", path, "-map", "0:a:0", "-af", "silencedetect=n=-30dB:d=0.05", "-f", "null", "-"])
  const end = /silence_end:\s*(-?[\d.]+)/.exec(stderr)
  return end ? Number(end[1]) : null
}

/**
 * Where the beep lands by SAMPLE COUNT: the first audio sample above half the
 * track's peak (above an encoder's pre-echo), as its index ÷ 48 kHz from the
 * audio stream's start. Unlike `beepTimeSec` this ignores timestamps, so a gap
 * a track carries would show here as a beep that comes early. Null for a
 * silent track.
 */
export async function beepSampleTimeSec(path: string): Promise<number | null> {
  const audio = (await probeStreams(path)).find((s) => s.codecType === "audio")
  if (!audio) return null
  const { stdout } = await execFileP("ffmpeg", ["-v", "error", "-i", path, "-map", "0:a:0", "-ac", "1", "-ar", "48000", "-f", "s16le", "-"], {
    encoding: "buffer",
    maxBuffer: 256 * 1024 * 1024,
  })
  let peak = 0
  for (let i = 0; 2 * i + 1 < stdout.length; i++) peak = Math.max(peak, Math.abs(stdout.readInt16LE(2 * i)))
  if (peak < 100) return null
  for (let i = 0; 2 * i + 1 < stdout.length; i++) {
    if (Math.abs(stdout.readInt16LE(2 * i)) > peak / 2) return (audio.startTime ?? 0) + i / 48000
  }
  return null
}

/** Tag a clip with a display rotation without re-encoding — a phone recording's shape. */
export async function tagRotation(src: string, dest: string, degrees: number): Promise<void> {
  await runFfmpeg(["-y", "-display_rotation", String(degrees), "-i", src, "-c", "copy", dest])
}

/** Remux with every timestamp shifted so the file starts at `seconds` (start_time > 0). `-ss 1 -c copy` does NOT produce one. */
export async function offsetStart(src: string, dest: string, seconds: number): Promise<void> {
  await runFfmpeg(["-y", "-i", src, "-c", "copy", "-output_ts_offset", String(seconds), dest])
}

export async function makeSolidPng(path: string, width: number, height: number, rgb: Rgb, alpha = 1): Promise<void> {
  await sharp({ create: { width, height, channels: 4, background: { r: rgb[0], g: rgb[1], b: rgb[2], alpha } } }).png().toFile(path)
}

/**
 * A stored 400×200 image whose LEFT half is red and RIGHT half blue, tagged
 * EXIF orientation 6 — displayed rotated 90° clockwise: top half red, bottom
 * half blue, 200×400. Squashed instead of rotated, the top-centre pixel would
 * be the red/blue seam.
 */
export async function makeExifSplit(path: string, format: "jpeg" | "webp"): Promise<void> {
  const width = 400
  const height = 200
  const raw = Buffer.alloc(width * height * 3)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 3
      if (x < width / 2) raw[i] = 255
      else raw[i + 2] = 255
    }
  }
  const img = sharp(raw, { raw: { width, height, channels: 3 } })
  await (format === "jpeg" ? img.jpeg({ quality: 95 }) : img.webp({ quality: 95 })).withMetadata({ orientation: 6 }).toFile(path)
}

/** Two-frame animated WebP: frame 1 red, frame 2 blue. sharp reports `pages: 2`. */
export async function makeAnimatedWebp(path: string): Promise<void> {
  const frame = (rgb: Rgb) =>
    sharp({ create: { width: 64, height: 64, channels: 4, background: { r: rgb[0], g: rgb[1], b: rgb[2], alpha: 1 } } }).png().toBuffer()
  await sharp([await frame([255, 0, 0]), await frame([0, 0, 255])], { join: { animated: true } })
    .webp({ loop: 0, delay: [200, 200] })
    .toFile(path)
}

/** Two-frame APNG (ffmpeg's apng muxer): frame 1 red, frame 2 blue. sharp reports `format: "png"`, no `pages`. */
export async function makeApng(path: string): Promise<void> {
  await runFfmpeg([
    "-y",
    "-f", "lavfi", "-i", "color=c=red:size=64x64:rate=5:duration=0.2",
    "-f", "lavfi", "-i", "color=c=blue:size=64x64:rate=5:duration=0.2",
    "-filter_complex", "[0:v][1:v]concat=n=2:v=1[v]", "-map", "[v]",
    "-plays", "0", "-f", "apng", path,
  ])
}

export interface StreamFacts {
  readonly codecType: string
  readonly codecName: string
  readonly width?: number
  readonly height?: number
  readonly sar?: string
  readonly rFrameRate?: string
  readonly startTime?: number
  readonly duration?: number
  readonly frames?: number
}

/** Every stream, with a DECODED video frame count (`-count_frames`). */
export async function probeStreams(path: string): Promise<StreamFacts[]> {
  const out = await runFfprobe([
    "-v", "error", "-count_frames",
    "-show_entries", "stream=codec_type,codec_name,width,height,sample_aspect_ratio,r_frame_rate,start_time,duration,nb_read_frames",
    "-of", "json", path,
  ])
  const streams = (JSON.parse(out) as { streams?: Array<Record<string, unknown>> }).streams ?? []
  return streams.map((s) => ({
    codecType: String(s.codec_type),
    codecName: String(s.codec_name),
    ...(typeof s.width === "number" ? { width: s.width } : {}),
    ...(typeof s.height === "number" ? { height: s.height } : {}),
    ...(typeof s.sample_aspect_ratio === "string" ? { sar: s.sample_aspect_ratio } : {}),
    ...(typeof s.r_frame_rate === "string" ? { rFrameRate: s.r_frame_rate } : {}),
    ...(s.start_time !== undefined ? { startTime: Number(s.start_time) } : {}),
    ...(s.duration !== undefined ? { duration: Number(s.duration) } : {}),
    ...(s.nb_read_frames !== undefined ? { frames: Number(s.nb_read_frames) } : {}),
  }))
}

/**
 * A loud clip for the mix's limiter: H.264 in a flat colour with a sine at
 * `amplitude` (linear; 1 = 0 dBFS — lavfi's own `sine` plays at 1/8), mono AAC.
 */
export async function makeLoudToneClip(path: string, o: { width: number; height: number; rgb: Rgb; durationSec: number; frequency: number; amplitude: number }): Promise<void> {
  await runFfmpeg([
    "-y",
    "-f", "lavfi", "-i", `color=c=${hex(o.rgb)}:size=${o.width}x${o.height}:rate=${FPS}:duration=${o.durationSec}`,
    "-f", "lavfi", "-i", `aevalsrc=${o.amplitude}*sin(2*PI*${o.frequency}*t):s=48000:d=${o.durationSec}`,
    "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "192k", "-shortest",
    path,
  ])
}

/**
 * The first audio stream decoded to 32-bit float samples, every channel
 * interleaved, and its rate — what a sample-peak meter reads (no
 * oversampling: inter-sample peaks are not counted).
 */
async function decodedSamples(path: string): Promise<{ readonly samples: Float32Array; readonly channels: number; readonly rate: number }> {
  const { stdout } = await execFileP("ffmpeg", ["-v", "error", "-i", path, "-map", "0:a:0", "-ar", "48000", "-f", "f32le", "-acodec", "pcm_f32le", "-"], {
    encoding: "buffer",
    maxBuffer: 256 * 1024 * 1024,
  })
  const channels = Number(
    (await runFfprobe(["-v", "error", "-select_streams", "a:0", "-show_entries", "stream=channels", "-of", "csv=p=0", path])).trim(),
  )
  const samples = new Float32Array(stdout.buffer.slice(stdout.byteOffset, stdout.byteOffset + stdout.byteLength - (stdout.byteLength % 4)))
  return { samples, channels: channels > 0 ? channels : 1, rate: 48000 }
}

const dbfs = (linear: number): number => 20 * Math.log10(Math.max(linear, 1e-12))

/** The sample peak, dBFS, of the first audio stream between `fromSec` and `toSec` (the whole stream by default). */
export async function samplePeakDbfs(path: string, fromSec = 0, toSec = Number.POSITIVE_INFINITY): Promise<number> {
  const { samples, channels, rate } = await decodedSamples(path)
  const start = Math.floor(fromSec * rate) * channels
  const end = Math.min(samples.length, Number.isFinite(toSec) ? Math.floor(toSec * rate) * channels : samples.length)
  let peak = 0
  for (let i = start; i < end; i++) peak = Math.max(peak, Math.abs(samples[i]!))
  return dbfs(peak)
}

/** The RMS level, dBFS, of the first audio stream between `fromSec` and `toSec`. */
export async function rmsDbfs(path: string, fromSec: number, toSec: number): Promise<number> {
  const { samples, channels, rate } = await decodedSamples(path)
  const start = Math.floor(fromSec * rate) * channels
  const end = Math.min(samples.length, Math.floor(toSec * rate) * channels)
  let sum = 0
  for (let i = start; i < end; i++) sum += samples[i]! * samples[i]!
  return dbfs(Math.sqrt(sum / Math.max(1, end - start)))
}

/** md5 of the first audio stream's packets, stream-copied — equal md5 = byte-identical audio. */
export async function audioMd5(path: string): Promise<string> {
  return (await runFfmpeg(["-v", "error", "-i", path, "-map", "0:a:0", "-c", "copy", "-f", "md5", "-"])).trim()
}

export interface Frame {
  readonly width: number
  readonly height: number
  readonly data: Buffer
}

/** One decoded RGB24 frame at output time `t` (raw bytes — execFile in buffer mode; runFfmpeg's utf8 stdout would corrupt them). */
export async function frameAt(path: string, t: number): Promise<Frame> {
  const dims = JSON.parse(
    await runFfprobe(["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "json", path]),
  ) as { streams: Array<{ width: number; height: number }> }
  const { width, height } = dims.streams[0]!
  const { stdout } = await execFileP(
    "ffmpeg",
    ["-v", "error", "-ss", t.toFixed(3), "-i", path, "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"],
    { encoding: "buffer", maxBuffer: 256 * 1024 * 1024 },
  )
  return { width, height, data: stdout }
}

export function pixel(f: Frame, x: number, y: number): Rgb {
  const i = (y * f.width + x) * 3
  return [f.data[i]!, f.data[i + 1]!, f.data[i + 2]!]
}

export function near(a: Rgb, b: Rgb, tol: number): boolean {
  return Math.abs(a[0] - b[0]) <= tol && Math.abs(a[1] - b[1]) <= tol && Math.abs(a[2] - b[2]) <= tol
}

export interface Box {
  readonly left: number
  readonly top: number
  readonly width: number
  readonly height: number
}

/** Bounding box of every pixel whose |Δr|+|Δg|+|Δb| from `rgb` exceeds `minDelta`; null when none does. */
export function changedBox(f: Frame, rgb: Rgb, minDelta = 48): Box | null {
  let x0 = f.width
  let y0 = f.height
  let x1 = -1
  let y1 = -1
  for (let y = 0; y < f.height; y++) {
    for (let x = 0; x < f.width; x++) {
      const i = (y * f.width + x) * 3
      const d = Math.abs(f.data[i]! - rgb[0]) + Math.abs(f.data[i + 1]! - rgb[1]) + Math.abs(f.data[i + 2]! - rgb[2])
      if (d > minDelta) {
        if (x < x0) x0 = x
        if (y < y0) y0 = y
        if (x > x1) x1 = x
        if (y > y1) y1 = y
      }
    }
  }
  return x1 < 0 ? null : { left: x0, top: y0, width: x1 - x0 + 1, height: y1 - y0 + 1 }
}

/** Run an argv whose graph contains `showinfo`; return each logged frame size `WxH`, in frame order. */
export async function showinfoSizes(args: string[]): Promise<string[]> {
  const { stderr } = await runFfmpegCapture(args)
  return [...stderr.matchAll(/\bn:\s*\d+\b[^\n]*?\bs:(\d+x\d+)/g)].map((m) => m[1]!)
}

/**
 * The per-frame drawn width the spec's S(t) produces for a layer `durSec`
 * long at 30 fps: S(t) = 0.96 + 0.04·min(1, t/R) − 0.04·max(0, (t − (dur − R))/R),
 * R = min(0.15, dur/2), width = trunc(W·S/2)·2 — the exact numbers ffmpeg's
 * `scale=…:eval=frame` must log, frame by frame.
 */
export function expectedScaleWidths(width: number, durSec: number): number[] {
  const r = Math.min(0.15, durSec / 2)
  const frames = Math.round(durSec * FPS)
  return Array.from({ length: frames }, (_, n) => {
    const t = n / FPS
    const s = 0.96 + 0.04 * Math.min(1, t / r) - 0.04 * Math.max(0, (t - (durSec - r)) / r)
    return Math.trunc((width * s) / 2) * 2
  })
}
