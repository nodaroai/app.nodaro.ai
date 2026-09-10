/**
 * Getting pixels out of an MP4, and nothing else.
 *
 * Frames are STREAMED, never collected: the table fixture is 720 frames and a
 * harness that buffers them all before measuring anything would hold ~140 MB
 * of decoded video for no reason, and would produce its first number only
 * after the last frame arrived. Every measurement in this harness needs at
 * most the current frame and its predecessor, so one pass with a callback is
 * both cheaper and the shape the measurements actually want.
 *
 * ffmpeg is LOCATED, not assumed: this repo installs a pinned static build at
 * `/usr/local/bin` in its images (`tools/install-pinned-ffmpeg.sh`), a
 * developer Mac has Homebrew's, and CI may have neither. The resolved path is
 * recorded in the receipt, because "which decoder produced these numbers" is
 * part of the evidence.
 */
import { spawn, spawnSync } from "node:child_process"

/** Candidate locations, most-pinned first. */
const FFMPEG_CANDIDATES = ["/usr/local/bin/ffmpeg", "/opt/homebrew/bin/ffmpeg", "ffmpeg"]
const FFPROBE_CANDIDATES = ["/usr/local/bin/ffprobe", "/opt/homebrew/bin/ffprobe", "ffprobe"]

function firstWorking(candidates, envOverride) {
  const list = envOverride ? [envOverride, ...candidates] : candidates
  for (const candidate of list) {
    const probe = spawnSync(candidate, ["-version"], { encoding: "utf8" })
    if (!probe.error && probe.status === 0) {
      return { path: candidate, version: (probe.stdout ?? "").split("\n")[0] ?? null }
    }
  }
  return null
}

export function resolveFfmpeg() {
  const found = firstWorking(FFMPEG_CANDIDATES, process.env.FFMPEG_PATH)
  if (!found) throw new Error("no usable ffmpeg found (tried $FFMPEG_PATH, /usr/local/bin, /opt/homebrew/bin, PATH)")
  return found
}

export function resolveFfprobe() {
  const found = firstWorking(FFPROBE_CANDIDATES, process.env.FFPROBE_PATH)
  if (!found) throw new Error("no usable ffprobe found (tried $FFPROBE_PATH, /usr/local/bin, /opt/homebrew/bin, PATH)")
  return found
}

/**
 * `24000/1001` and friends. Returned as a number AND kept as the raw string,
 * because "23.976 or 24" is exactly the kind of thing a contract check is
 * about and rounding it away in the receipt would hide the answer.
 */
export function parseRational(text) {
  if (typeof text !== "string" || text === "") return null
  const [num, den] = text.split("/")
  const n = Number(num)
  const d = den === undefined ? 1 : Number(den)
  if (!Number.isFinite(n) || !Number.isFinite(d) || d === 0) return null
  return n / d
}

/** What the container says it holds. Read BEFORE any measurement is trusted. */
export function probeVideo(ffprobePath, file) {
  const args = ["-v", "error", "-select_streams", "v:0", "-count_frames",
    "-show_entries", "stream=width,height,r_frame_rate,avg_frame_rate,nb_read_frames,codec_name,duration",
    "-show_entries", "format=duration", "-of", "json", file]
  const result = spawnSync(ffprobePath, args, { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`ffprobe failed (${result.status}): ${(result.stderr ?? "").trim().slice(0, 400)}`)
  const parsed = JSON.parse(result.stdout)
  const stream = parsed?.streams?.[0] ?? {}
  const frames = Number(stream.nb_read_frames)
  const duration = Number(stream.duration ?? parsed?.format?.duration)
  return {
    width: Number(stream.width) || null,
    height: Number(stream.height) || null,
    codec: stream.codec_name ?? null,
    rFrameRate: stream.r_frame_rate ?? null,
    fps: parseRational(stream.r_frame_rate) ?? parseRational(stream.avg_frame_rate),
    frames: Number.isFinite(frames) ? frames : null,
    durationSeconds: Number.isFinite(duration) ? duration : null,
  }
}

/**
 * The analysis raster: the source width scaled down, height derived from the
 * SOURCE aspect and forced even (rawvideo has no padding, and an odd height
 * silently shifts every row of every later frame by a pixel).
 */
export function analysisSize(sourceWidth, sourceHeight, targetWidth) {
  if (!sourceWidth || !sourceHeight) throw new Error("cannot derive an analysis raster without source dimensions")
  const width = Math.max(2, Math.round(targetWidth / 2) * 2)
  const height = Math.max(2, Math.round((sourceHeight * width) / sourceWidth / 2) * 2)
  return { width, height }
}

/**
 * Decode every frame at `width`x`height` and hand it to `onFrame(rgb, index)`.
 *
 * The buffer handed to the callback is REUSED between frames: a caller that
 * needs to keep one (the previous frame, for a difference) copies it. That is
 * the deliberate trade — one allocation instead of 720.
 */
export function streamFrames(ffmpegPath, file, { width, height, onFrame }) {
  return new Promise((resolve, reject) => {
    const frameBytes = width * height * 3
    const child = spawn(ffmpegPath, [
      "-v", "error", "-nostdin", "-i", file,
      "-vf", `scale=${width}:${height}:flags=bilinear`,
      "-f", "rawvideo", "-pix_fmt", "rgb24", "pipe:1",
    ], { stdio: ["ignore", "pipe", "pipe"] })

    let pending = Buffer.alloc(0)
    let index = 0
    let failed = null
    let stderr = ""

    child.stderr.on("data", (chunk) => { stderr += chunk.toString() })
    child.stdout.on("data", (chunk) => {
      if (failed) return
      pending = pending.length === 0 ? chunk : Buffer.concat([pending, chunk])
      while (pending.length >= frameBytes) {
        const frame = pending.subarray(0, frameBytes)
        pending = pending.subarray(frameBytes)
        try {
          onFrame(frame, index)
        } catch (error) {
          failed = error
          child.kill("SIGKILL")
          return
        }
        index++
      }
    })
    child.on("error", reject)
    child.on("close", (code) => {
      if (failed) return reject(failed)
      if (code !== 0) return reject(new Error(`ffmpeg exited ${code}: ${stderr.trim().slice(0, 400)}`))
      resolve({ frames: index, trailingBytes: pending.length, width, height })
    })
  })
}

/**
 * Mean absolute per-channel difference between two rgb24 frames, 0-255.
 *
 * Mean rather than a histogram or a structural measure on purpose: the cut
 * check reads the SHAPE of the difference sequence (a spike against its
 * neighbours), not the absolute value, so the cheapest monotone measure is
 * the honest one. Sub-sampling would make a small fast-moving subject
 * disappear, so every pixel is read.
 */
export function meanAbsDiff(a, b) {
  if (a.length !== b.length) throw new Error("frame size changed mid-stream")
  let total = 0
  for (let i = 0; i < a.length; i++) total += Math.abs(a[i] - b[i])
  return total / a.length
}

/** Euclidean distance between two centroids, or `null` when either is absent. */
export function centroidDelta(a, b) {
  if (!a || !b) return null
  return Math.hypot(a.x - b.x, a.y - b.y)
}

/**
 * Split a per-frame motion series into a slow component and a fast one.
 *
 * The fixture asks for "a lazy body sway in long waves PLUS a very small
 * tremor" — two components, not one amount of movement. A moving average over
 * `window` frames is the sway; what is left is the tremor. Reported as
 * numbers, never as a verdict: the contract's own wording ("real, slow
 * handheld, not wiggle") is a judgement a human makes from these.
 */
export function swayAndTremor(series, window = 12) {
  const values = series.filter((v) => typeof v === "number" && Number.isFinite(v))
  if (values.length === 0) return { samples: 0, mean: null, sway: null, tremor: null, tremorRatio: null }
  const smoothed = values.map((_, i) => {
    const from = Math.max(0, i - Math.floor(window / 2))
    const to = Math.min(values.length, i + Math.ceil(window / 2))
    let sum = 0
    for (let j = from; j < to; j++) sum += values[j]
    return sum / (to - from)
  })
  const mean = values.reduce((a, b) => a + b, 0) / values.length
  const sway = smoothed.reduce((a, b) => a + Math.abs(b - mean), 0) / smoothed.length
  const tremor = values.reduce((a, b, i) => a + Math.abs(b - smoothed[i]), 0) / values.length
  return {
    samples: values.length,
    mean,
    sway,
    tremor,
    tremorRatio: sway === 0 ? null : tremor / sway,
    window,
  }
}
