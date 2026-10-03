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
