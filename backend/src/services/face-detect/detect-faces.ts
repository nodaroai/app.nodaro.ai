/**
 * FACE DETECTION ON A DETECTION PROXY — the core half of Speaker Frames
 * (P3.3; decided 2026-10-06, P3-25 (a)). Lent to plugins as
 * `tk.media.detectFaces`.
 *
 * One call is one WINDOW of a proxy made by `ensureMediaProxy(url, "video",
 * { fps: 2, height: 540, spans })`: frames `[fromFrame, toFrame)`, at most
 * `FACE_DETECT_MAX_FRAMES_PER_CALL`. Core owns everything with a clock, a
 * native module or a memory peak in it:
 *   - the decode: ffmpeg streams exactly the window's frames as raw BGR,
 *     frame-exact by index (an input seek half a period before the window's
 *     first frame, then a frame count), through the one launcher;
 *   - the detector: YuNet through onnxruntime-node, the pinned model
 *     (`yunet-model.ts`), the probe's decode and NMS (`yunet-decode.ts`);
 *   - the admission: the decode child AND the inference run inside ONE
 *     `withFfmpegSlot` hold reserving `faceDetectPeakMemoryMiB` (#1860), at the
 *     thread counts that actually run (#1841);
 *   - the clock: every frame goes through `proxyFrameToSourceMs`, the span
 *     map's own function, so a box comes back on the SOURCE clock — or, for a
 *     frame no row holds, is dropped and counted, never given a guessed time.
 * The caller owns the taste: the score floor (`minScore`; Speaker Frames
 * passes 0.7), and everything done with the boxes afterwards.
 *
 * Refusals come before any reservation: a malformed window, a URL that is not
 * our own stored proxy, and a host that cannot detect (model or native binary
 * missing) are all deterministic — the job fails and refunds once.
 */
import {
  ffmpegFailureMessage,
  runFfprobe,
  withFfmpegSlot,
} from "../../providers/video/ffmpeg-utils.js"
import { spawnFfmpeg } from "../../providers/video/ffmpeg-process.js"
import { ffmpegEffectiveThreads } from "../../providers/video/ffmpeg-threads.js"
import { DeterministicJobError } from "../../lib/deterministic-job-error.js"
import { r2KeyFromOurUrl } from "../../lib/storage.js"
import { proxyFrameToSourceMs, type ProxySpanMap } from "../media-proxy-span-map.js"
import {
  FACE_DETECT_MAX_FRAMES_PER_CALL,
  faceDetectCaps,
  faceDetectPeakMemoryMiB,
  faceDetectTimeoutMs,
} from "./face-detect-budget.js"
import { decodeYunet, fillYunetInput, paddedSize, rgbThumb, type YunetFace } from "./yunet-decode.js"
import { yunetSession } from "./yunet-session.js"

/** The setup thumbnail's size (P3-30 (b)): 16 × 9 cells of RGB. */
export const FACE_DETECT_THUMB = { w: 16, h: 9 } as const

/** The request is malformed or names a file that is not ours. */
export class FaceDetectRequestError extends DeterministicJobError {
  constructor(message: string) {
    super(`face detect: ${message}`)
    this.name = "FaceDetectRequestError"
  }
}

/** The window's result would pass the speaker-track caps (P3.1). */
export class FaceDetectCapError extends DeterministicJobError {
  constructor(message: string) {
    super(`face detect: ${message}`)
    this.name = "FaceDetectCapError"
  }
}

export interface DetectFacesWindow {
  /** The proxy's frame rate (`VideoProxyResult.fps`). */
  readonly fps: number
  /** The proxy's span map (`VideoProxyResult.spanMap`): its only clock. */
  readonly spanMap: ProxySpanMap
  /** First proxy frame, inclusive. */
  readonly fromFrame: number
  /** Last proxy frame, exclusive. At most `FACE_DETECT_MAX_FRAMES_PER_CALL` after `fromFrame`. */
  readonly toFrame: number
  /** Keep faces scoring at least this, in (0, 1]. */
  readonly minScore: number
  /** Also return a `FACE_DETECT_THUMB` RGB thumbnail per frame (base64). */
  readonly thumb?: boolean
}

export interface DetectFacesInput extends DetectFacesWindow {
  /** The proxy's URL (`VideoProxyResult.url`) — our own storage only. */
  readonly proxyUrl: string
}

export interface DetectedFrame {
  /** Proxy frame index. */
  readonly frame: number
  /** Where the frame sits on the SOURCE clock, ms (through the span map). */
  readonly sourceMs: number
  /** Highest score first. Top-left boxes and landmarks, fractions of `frame`. */
  readonly boxes: readonly YunetFace[]
  /** `FACE_DETECT_THUMB.w × .h` RGB bytes, base64 — only when asked for. */
  readonly thumb?: string
}

export interface DetectFacesResult {
  /** What a track set records as its detector (P3-7). */
  readonly detector: { readonly id: string; readonly version: string }
  /** The proxy's picture size: what the fractions refer to. */
  readonly frame: { readonly w: number; readonly h: number }
  /** The window's frames that a span-map row holds, in order. */
  readonly frames: readonly DetectedFrame[]
  /** Frames decoded but held by no span-map row — dropped, never given a time. */
  readonly dropped: number
  /** Boxes in `frames`. */
  readonly boxCount: number
  /** This process's CPU while the call held its admission slot, ms (inference
   *  and JS). Sampled inside the hold, so the wait for a slot or for memory is
   *  not in it; the decode child is not included, and neither is concurrent
   *  in-process work during the hold, which it cannot tell apart. */
  readonly cpuMs: number
}

const round = (v: number, places: number) => Number(v.toFixed(places))

/** Fractions to 6 places (a thousandth of a pixel at 960 px), scores to 4. */
function roundFace(f: YunetFace): YunetFace {
  return {
    x: round(f.x, 6),
    y: round(f.y, 6),
    w: round(f.w, 6),
    h: round(f.h, 6),
    score: round(f.score, 4),
    landmarks: f.landmarks.map(([lx, ly]) => [round(lx, 6), round(ly, 6)] as const),
  }
}

/** Check the window; returns the proxy's frame count per the map. */
function validateWindow(w: DetectFacesWindow): number {
  if (!(typeof w.fps === "number" && Number.isFinite(w.fps) && w.fps > 0 && w.fps <= 60)) {
    throw new FaceDetectRequestError(`fps ${w.fps} is not in (0, 60]`)
  }
  if (!Array.isArray(w.spanMap) || w.spanMap.length === 0) throw new FaceDetectRequestError("the span map is empty")
  let total = 0
  for (const [i, r] of w.spanMap.entries()) {
    const finite = [r?.proxyStartMs, r?.proxyEndMs, r?.sourceStartMs].every((v) => typeof v === "number" && Number.isFinite(v))
    if (!finite || !Number.isInteger(r.firstFrame) || r.firstFrame < 0 || !Number.isInteger(r.frameCount) || r.frameCount < 1) {
      throw new FaceDetectRequestError(`span map row ${i} is malformed`)
    }
    total = Math.max(total, r.firstFrame + r.frameCount)
  }
  const { fromFrame: from, toFrame: to } = w
  if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to <= from) {
    throw new FaceDetectRequestError(`frames [${from}, ${to}) are not a window`)
  }
  if (to > total) throw new FaceDetectRequestError(`frame ${to - 1} is past the proxy's ${total} frames`)
  if (to - from > FACE_DETECT_MAX_FRAMES_PER_CALL) {
    throw new FaceDetectRequestError(`a window of ${to - from} frames is over the ${FACE_DETECT_MAX_FRAMES_PER_CALL}-frame cap`)
  }
  if (!(typeof w.minScore === "number" && w.minScore > 0 && w.minScore <= 1)) {
    throw new FaceDetectRequestError(`minScore ${w.minScore} is not in (0, 1]`)
  }
  return total
}

/** Where proxy frame `k` sits in the proxy's own time, ms — from the row that
 *  holds it (or the last row before it), on that row's frame grid. */
function proxyMsOfFrame(map: ProxySpanMap, fps: number, k: number): number {
  let row: ProxySpanMap[number] | undefined
  for (const r of map) if (r.firstFrame <= k && (!row || r.firstFrame >= row.firstFrame)) row = r
  return row ? row.proxyStartMs + ((k - row.firstFrame) * 1000) / fps : (k * 1000) / fps
}

/** The proxy's picture size and container start. */
async function probeProxy(source: string): Promise<{ width: number; height: number; startMs: number }> {
  const out = await runFfprobe([
    "-v", "error", "-select_streams", "v:0",
    "-show_entries", "stream=width,height:format=start_time",
    "-of", "json", source,
  ])
  const parsed = JSON.parse(out) as { streams?: Array<{ width?: number; height?: number }>; format?: { start_time?: string } }
  const s = parsed.streams?.[0]
  if (!s || !Number.isInteger(s.width) || !Number.isInteger(s.height) || s.width! <= 0 || s.height! <= 0) {
    throw new FaceDetectRequestError("the proxy has no video stream")
  }
  const start = Number.parseFloat(parsed.format?.start_time ?? "0")
  return { width: s.width!, height: s.height!, startMs: Number.isFinite(start) ? start * 1000 : 0 }
}

/**
 * Decode `frames` frames of `source` from `seekSec` as packed BGR, one frame
 * buffer at a time. The buffer is REUSED: the consumer finishes with a frame
 * before asking for the next (an async generator's own rhythm). Throws when
 * ffmpeg fails; the caller checks the count. Spawned only inside the caller's
 * admission hold.
 */
async function* streamBgrFrames(
  source: string,
  opts: { seekSec: number; frames: number; width: number; height: number; timeoutMs: number },
): AsyncGenerator<Buffer> {
  const args = [
    "-nostdin", "-v", "error",
    ...(opts.seekSec > 0 ? ["-ss", opts.seekSec.toFixed(6)] : []),
    "-noautorotate",
    "-i", source,
    "-map", "0:v:0", "-an", "-sn", "-dn",
    "-frames:v", String(opts.frames),
    "-f", "rawvideo", "-pix_fmt", "bgr24",
    "pipe:1",
  ]
  const proc = spawnFfmpeg(args, { stdio: ["ignore", "pipe", "pipe"] })
  let stderr = ""
  proc.stderr.on("data", (c: Buffer) => { stderr = (stderr + c.toString()).slice(-8_000) })
  const closed = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve, reject) => {
    proc.on("error", reject)
    proc.on("close", (code: number | null, signal: NodeJS.Signals | null) => resolve({ code, signal }))
  })
  closed.catch(() => undefined)
  let timedOut = false
  const watchdog = setTimeout(() => { timedOut = true; proc.kill("SIGKILL") }, opts.timeoutMs)
  const size = opts.width * opts.height * 3
  const frame = Buffer.allocUnsafe(size)
  let filled = 0
  let emitted = 0
  try {
    for await (const chunk of proc.stdout as AsyncIterable<Buffer>) {
      let at = 0
      while (at < chunk.length && emitted < opts.frames) {
        const take = Math.min(size - filled, chunk.length - at)
        chunk.copy(frame, filled, at, at + take)
        filled += take
        at += take
        if (filled === size) {
          filled = 0
          emitted++
          yield frame
        }
      }
    }
    const { code, signal } = await closed
    if (timedOut) throw new Error(`face detect: the decode passed its ${Math.round(opts.timeoutMs / 1000)} s budget`)
    if (code !== 0) throw new Error(ffmpegFailureMessage(stderr, signal ? `killed (${signal})` : `exit ${code}`))
  } finally {
    clearTimeout(watchdog)
    // An early return (a cap hit, a failed run) leaves ffmpeg mid-stream.
    if (proc.exitCode === null) proc.kill("SIGKILL")
  }
}

/**
 * Detect faces in a window of `source` — a LOCAL path or a URL already known
 * to be ours. `detectFaces` is the member; this is its body, reached directly
 * only by tests with a fixture file.
 */
export async function detectFacesInMedia(source: string, window: DetectFacesWindow): Promise<DetectFacesResult> {
  validateWindow(window)
  const { fps, spanMap, fromFrame, toFrame, minScore } = window
  // Refuse before reserving: no model or no native module is a deterministic refusal.
  const session = await yunetSession()
  const { width, height, startMs } = await probeProxy(source)
  const { pw, ph } = paddedSize(width, height)
  const frames = toFrame - fromFrame
  const timeoutMs = faceDetectTimeoutMs(frames)
  const peakMemoryMiB = faceDetectPeakMemoryMiB({ width, height }, session.intraOpThreads, ffmpegEffectiveThreads())
  const caps = faceDetectCaps()
  // Half a period before the first frame: frame-exact whatever the seek's rounding.
  const seekSec = fromFrame === 0 ? 0 : Math.max(0, (proxyMsOfFrame(spanMap, fps, fromFrame) - startMs - 500 / fps) / 1000)

  const collected = await withFfmpegSlot(async () => {
    // CPU is sampled inside the hold: the wait for a slot runs other jobs.
    const cpu0 = process.cpuUsage()
    const input = new Float32Array(3 * pw * ph)
    const out: DetectedFrame[] = []
    let dropped = 0
    let boxCount = 0
    let k = fromFrame
    for await (const bgr of streamBgrFrames(source, { seekSec, frames, width, height, timeoutMs })) {
      const index = k++
      const sourceMs = proxyFrameToSourceMs(spanMap, fps, index)
      if (sourceMs === undefined) {
        dropped++
        continue
      }
      fillYunetInput(bgr, width, height, pw, ph, input)
      const outputs = await session.run(input, pw, ph)
      const boxes = decodeYunet(outputs, { pw, ph, width, height, minScore }).map(roundFace)
      boxCount += boxes.length
      if (boxCount > caps.maxBoxes) {
        throw new FaceDetectCapError(`a window holds more than ${caps.maxBoxes} boxes (the per-source cap) by frame ${index}`)
      }
      const thumb = window.thumb
        ? Buffer.from(rgbThumb(bgr, width, height, FACE_DETECT_THUMB.w, FACE_DETECT_THUMB.h)).toString("base64")
        : undefined
      out.push(thumb === undefined ? { frame: index, sourceMs, boxes } : { frame: index, sourceMs, boxes, thumb })
    }
    const decoded = k - fromFrame
    if (decoded !== frames) throw new Error(`face detect: the proxy gave ${decoded} of ${frames} frames from frame ${fromFrame}`)
    const cpu = process.cpuUsage(cpu0)
    return { frames: out, dropped, boxCount, cpuMs: Math.round((cpu.user + cpu.system) / 1000) }
  }, { timeoutMs, peakMemoryMiB, label: "face-detect" })

  const result: DetectFacesResult = {
    detector: session.detector,
    frame: { w: width, h: height },
    ...collected,
  }
  const bytes = Buffer.byteLength(JSON.stringify(result))
  if (bytes > caps.maxBytes) throw new FaceDetectCapError(`a window's result is ${bytes} bytes, over the ${caps.maxBytes}-byte cap`)
  return result
}

/**
 * `tk.media.detectFaces`: detect faces in one window of a detection proxy this
 * platform stored (`ensureMediaProxy`). Any other URL is refused — the decode
 * reads it directly (ranged), so it must be ours.
 */
export async function detectFaces(input: DetectFacesInput): Promise<DetectFacesResult> {
  if (typeof input?.proxyUrl !== "string" || !r2KeyFromOurUrl(input.proxyUrl)) {
    throw new FaceDetectRequestError("the proxy URL is not a file this platform stored — pass ensureMediaProxy's url")
  }
  const { proxyUrl, ...window } = input
  return detectFacesInMedia(proxyUrl, window)
}
