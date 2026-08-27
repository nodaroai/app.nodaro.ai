/**
 * GIF → MP4 conversion for the `gif-to-video` node.
 *
 * Turns an animated GIF into a widely-compatible H.264 MP4 that can be fed as a
 * motion reference to video models (Seedance et al., which reject GIF in the
 * video-reference slot). Pure local FFmpeg — no provider call, no credits.
 *
 * Pipeline (adapted from the feature spec to FFmpeg/ffprobe — no Python):
 *   1. Probe frame count, real duration (container duration sums the GIF's
 *      per-frame delays), dimensions and pixel format.
 *   2. Single-frame GIF (a still wearing a .gif extension) → emit a short
 *      static clip + a warning, rather than failing.
 *   3. Seam detection — compare first vs last decoded frame (downscaled
 *      greyscale mean-abs-diff via sharp). Seamless loops repeat end-to-end;
 *      non-seamless loops ping-pong (forward + reversed) so a hard repeat's
 *      jump-cut doesn't get reproduced by the model as a motion event.
 *   4. Normalise to a constant 24fps — `minterpolate` for genuinely smooth
 *      motion (default) or a plain `fps` duplicate to preserve the original
 *      stepped timing.
 *   5. Encode H.264: even dimensions (yuv420p requirement), yuv420p pixel
 *      format, faststart, alpha flattened onto a solid background.
 *   6. Re-probe and validate; on failure fall back to plain `fps` once.
 *
 * The alpha flatten is unconditional: overlaying an opaque GIF onto a solid
 * colour is a no-op, and it guarantees transparent GIFs don't composite onto
 * FFmpeg's default black when converting to yuv420p.
 */
import { join } from "node:path"
import { promises as fs } from "node:fs"
import sharp from "sharp"
import { runFfmpeg, runFfprobe, probeVideoSource } from "./ffmpeg-utils.js"

/**
 * Reference-clip targets. Defaults track the tightest Seedance constraints
 * (video-reference floor ~2s, sweet spot 3-8s, ≤720p input) but the node is
 * decoupled from any specific model — the MP4 is a normal video that connects
 * downstream by an ordinary edge. Kept as one object so it can be tuned in one
 * place if a target model's limits change.
 */
export const GIF_CLIP_TARGET = {
  /** Hard floor a reference clip must clear (below this, we always loop). */
  minDurationSeconds: 2,
  /** Preferred window — looping aims for the low end, trimming clamps the high. */
  targetWindowMin: 3,
  targetWindowMax: 8,
  /** Constant output frame rate. */
  normalizedFps: 24,
  /** Cap the long side; extra resolution costs money without helping motion. */
  defaultMaxResolution: 720,
  /** Mean-abs-diff (0..1) below which first≈last → the loop is seamless. */
  seamThreshold: 0.05,
  /** Below these, warn the user there isn't enough motion for a useful ref. */
  lowMotionFrameFloor: 6,
  lowMotionDurationFloor: 0.5,
} as const

export type GifAlphaBackground = "white" | "black"

export type GifLoopStrategy = "none" | "repeat" | "pingpong" | "trim" | "static"

export interface GifToVideoOptions {
  /** Local path to the downloaded GIF (the handler owns download + caching). */
  readonly gifPath: string
  /** Work directory for intermediates + the output. */
  readonly workDir: string
  /** Extend short GIFs by looping up to the target window. When false, a GIF
   *  already ≥ the floor is converted as-is (a GIF below the floor is still
   *  looped — the reference slot rejects sub-floor clips). */
  readonly loopToMinimum?: boolean
  /** Target duration when looping (clamped into [targetWindowMin, targetWindowMax]). */
  readonly targetDuration?: number
  /** true → minterpolate (smooth). false → plain fps (preserve stepped timing). */
  readonly interpolate?: boolean
  /** Colour to flatten transparency onto. Default white. */
  readonly alphaBackground?: GifAlphaBackground
  /** Long-side resolution cap. Default 720. */
  readonly maxResolution?: number
}

export interface GifToVideoResult {
  readonly outputPath: string
  readonly sourceFrames: number
  readonly sourceDurationSeconds: number
  readonly outputDurationSeconds: number
  readonly loopStrategy: GifLoopStrategy
  readonly loops: number
  readonly seamless: boolean
  readonly hadAlpha: boolean
  readonly interpolated: boolean
  readonly warning?: string
}

interface GifProbe {
  width: number
  height: number
  frames: number
  durationSeconds: number
  hadAlpha: boolean
}

/**
 * Probe a local GIF: dimensions, decoded frame count, real duration, and
 * whether the pixel format carries alpha. Container `format=duration` already
 * sums the per-frame delays, so mixed-delay GIFs report their true playback
 * length without parsing each frame. Falls back to 100ms/frame when the
 * duration is missing (what browsers assume).
 */
async function probeGif(gifPath: string): Promise<GifProbe> {
  const out = await runFfprobe([
    "-v", "error",
    "-select_streams", "v:0",
    "-count_frames",
    "-show_entries", "stream=width,height,pix_fmt,nb_read_frames:format=duration",
    "-of", "json",
    gifPath,
  ])
  const parsed = JSON.parse(out) as {
    streams?: Array<{ width?: number; height?: number; pix_fmt?: string; nb_read_frames?: string }>
    format?: { duration?: string }
  }
  const stream = parsed.streams?.[0]
  if (!stream || !stream.width || !stream.height) {
    throw new Error("Could not read GIF dimensions — the file may be corrupt or not a GIF")
  }
  const frames = Math.max(1, parseInt(stream.nb_read_frames ?? "1", 10) || 1)
  const rawDuration = parseFloat(parsed.format?.duration ?? "")
  const durationSeconds =
    Number.isFinite(rawDuration) && rawDuration > 0 ? rawDuration : frames * 0.1
  const pixFmt = stream.pix_fmt ?? ""
  const hadAlpha = /a$|^ya|^bgra|^rgba|^argb|^abgr|pal8/.test(pixFmt)
  return {
    width: stream.width,
    height: stream.height,
    frames,
    durationSeconds,
    hadAlpha,
  }
}

/**
 * Seam detection: extract the first and last frames, downscale to a small
 * greyscale grid, and return the normalised mean-abs-difference (0..1). A low
 * value means last ≈ first → the GIF is already a tight loop and can repeat
 * end-to-end without a visible jump.
 */
async function firstLastMeanDiff(
  gifPath: string,
  frames: number,
  workDir: string,
): Promise<number> {
  const pattern = join(workDir, "seam_%02d.png")
  // Single pass extracts frame 0 and the final frame.
  await runFfmpeg([
    "-y", "-i", gifPath,
    "-vf", `select='eq(n\\,0)+eq(n\\,${frames - 1})',scale=32:32`,
    "-vsync", "0",
    "-frames:v", "2",
    pattern,
  ])
  const firstBuf = await sharp(join(workDir, "seam_01.png")).greyscale().raw().toBuffer()
  const lastBuf = await sharp(join(workDir, "seam_02.png")).greyscale().raw().toBuffer()
  const len = Math.min(firstBuf.length, lastBuf.length)
  if (len === 0) return 1
  let sum = 0
  for (let i = 0; i < len; i++) sum += Math.abs(firstBuf[i]! - lastBuf[i]!)
  return sum / len / 255
}

function scaleFilter(maxResolution: number): string {
  // Cap the long side to maxResolution (fit inside a max×max box preserving
  // aspect), then round both dimensions to even numbers for yuv420p.
  return (
    `scale='min(${maxResolution},iw)':'min(${maxResolution},ih)':force_original_aspect_ratio=decrease,` +
    `scale=trunc(iw/2)*2:trunc(ih/2)*2`
  )
}

function fpsFilter(interpolate: boolean): string {
  const fps = GIF_CLIP_TARGET.normalizedFps
  return interpolate
    ? `minterpolate=fps=${fps}:mi_mode=mci:mc_mode=aobmc:vsbmc=1`
    : `fps=${fps}`
}

/**
 * Flatten a GIF's transparency onto a solid background without a second timed
 * input: split the GIF's own frames, paint one copy entirely `bg`, and overlay
 * the original on top. The plate inherits the GIF's timestamps/cadence, so the
 * result feeds fps/minterpolate at the GIF's real frame rate. Produces the
 * `[comp]` label. Overlaying an opaque GIF is a no-op, so this is unconditional.
 */
function flattenAlpha(bg: GifAlphaBackground): string {
  return (
    `[0:v]format=rgba,split[base][fg];` +
    `[base]drawbox=x=0:y=0:w=iw:h=ih:color=${bg}@1:t=fill[bgc];` +
    `[bgc][fg]overlay[comp]`
  )
}

const ENCODE_ARGS = [
  "-c:v", "libx264", "-crf", "18", "-pix_fmt", "yuv420p",
  "-movflags", "+faststart", "-an",
] as const

function clampTarget(requested: number | undefined): number {
  const t = requested ?? GIF_CLIP_TARGET.targetWindowMin
  return Math.min(GIF_CLIP_TARGET.targetWindowMax, Math.max(GIF_CLIP_TARGET.targetWindowMin, t))
}

/**
 * Build the looping "unit" clip — a single normalised, scaled, encoded pass
 * that the caller then repeats to reach the target duration. Seamless GIFs use
 * a forward pass; non-seamless GIFs ping-pong (forward + reversed) so the unit
 * is itself a clean loop.
 */
async function buildUnit(
  opts: Required<Pick<GifToVideoOptions, "gifPath" | "alphaBackground" | "maxResolution">> & {
    workDir: string
    interpolate: boolean
    pingpong: boolean
    trimToMax: boolean
  },
): Promise<string> {
  const { gifPath, workDir, interpolate, pingpong, alphaBackground, maxResolution, trimToMax } = opts
  const unitPath = join(workDir, "unit.mp4")
  // Flatten alpha onto a solid background derived FROM the GIF itself (a
  // filled copy of its own frames), so the composite keeps the GIF's native
  // cadence. Using a separate `color` lavfi source as overlay's main input
  // would re-clock the stream to color's default 25fps of duplicated frames,
  // which then defeats minterpolate (interpolating between identical frames).
  const shape = pingpong
    ? `[comp]split[a][b];[b]reverse[r];[a][r]concat=n=2:v=1[pp];[pp]${fpsFilter(interpolate)},${scaleFilter(maxResolution)}[out]`
    : `[comp]${fpsFilter(interpolate)},${scaleFilter(maxResolution)}[out]`
  const trimArgs = trimToMax ? ["-t", String(GIF_CLIP_TARGET.targetWindowMax)] : []
  await runFfmpeg([
    "-y",
    "-i", gifPath,
    "-filter_complex", `${flattenAlpha(alphaBackground)};${shape}`,
    "-map", "[out]",
    ...ENCODE_ARGS,
    ...trimArgs,
    unitPath,
  ])
  return unitPath
}

/** Concat a unit clip M times (stream copy) to reach the target duration. */
async function loopUnit(unitPath: string, loops: number, workDir: string): Promise<string> {
  const outputPath = join(workDir, "output.mp4")
  const escaped = unitPath.replace(/'/g, "'\\''")
  const listPath = join(workDir, "loop-list.txt")
  await fs.writeFile(listPath, Array.from({ length: loops }, () => `file '${escaped}'`).join("\n"))
  await runFfmpeg([
    "-y", "-f", "concat", "-safe", "0", "-i", listPath,
    "-c", "copy", "-movflags", "+faststart",
    outputPath,
  ])
  return outputPath
}

/** Build a static clip from a single-frame GIF (a still saved as .gif). */
async function buildStatic(
  gifPath: string,
  workDir: string,
  bg: GifAlphaBackground,
  maxResolution: number,
): Promise<string> {
  const outputPath = join(workDir, "output.mp4")
  await runFfmpeg([
    "-y",
    "-loop", "1", "-t", String(GIF_CLIP_TARGET.targetWindowMin), "-i", gifPath,
    "-filter_complex",
    `${flattenAlpha(bg)};[comp]fps=${GIF_CLIP_TARGET.normalizedFps},${scaleFilter(maxResolution)}[out]`,
    "-map", "[out]",
    ...ENCODE_ARGS,
    outputPath,
  ])
  return outputPath
}

async function assertValidOutput(outputPath: string): Promise<number> {
  const { width, height, durationSeconds } = await probeVideoSource(outputPath)
  if (width <= 0 || height <= 0 || width % 2 !== 0 || height % 2 !== 0) {
    throw new Error(`gif-to-video produced invalid dimensions ${width}x${height}`)
  }
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    throw new Error("gif-to-video produced a zero-duration clip")
  }
  return durationSeconds
}

export async function gifToVideo(options: GifToVideoOptions): Promise<GifToVideoResult> {
  const {
    gifPath,
    workDir,
    loopToMinimum = true,
    targetDuration,
    alphaBackground = "white",
    maxResolution = GIF_CLIP_TARGET.defaultMaxResolution,
  } = options

  const probe = await probeGif(gifPath)
  const warnings: string[] = []

  // --- Single-frame GIF: emit a static clip rather than failing. -----------
  if (probe.frames <= 1) {
    const outputPath = await buildStatic(gifPath, workDir, alphaBackground, maxResolution)
    const outputDurationSeconds = await assertValidOutput(outputPath)
    return {
      outputPath,
      sourceFrames: probe.frames,
      sourceDurationSeconds: probe.durationSeconds,
      outputDurationSeconds,
      loopStrategy: "static",
      loops: 1,
      seamless: true,
      hadAlpha: probe.hadAlpha,
      interpolated: false,
      warning: "GIF has a single frame (no motion) — produced a static clip.",
    }
  }

  if (
    probe.frames < GIF_CLIP_TARGET.lowMotionFrameFloor ||
    probe.durationSeconds < GIF_CLIP_TARGET.lowMotionDurationFloor
  ) {
    warnings.push(
      "Very little motion in the source — the reference may be too weak to drive the model.",
    )
  }

  const seamDiff = await firstLastMeanDiff(gifPath, probe.frames, workDir)
  const seamless = seamDiff < GIF_CLIP_TARGET.seamThreshold

  // --- Decide loop strategy ------------------------------------------------
  const overMax = probe.durationSeconds > GIF_CLIP_TARGET.targetWindowMax
  const needExtend =
    !overMax && (loopToMinimum || probe.durationSeconds < GIF_CLIP_TARGET.minDurationSeconds)

  let loopStrategy: GifLoopStrategy
  let pingpong = false
  if (overMax) {
    loopStrategy = "trim"
  } else if (!needExtend) {
    loopStrategy = "none"
  } else if (seamless) {
    loopStrategy = "repeat"
  } else {
    loopStrategy = "pingpong"
    pingpong = true
  }

  // One retry: minterpolate can smear on high-contrast graphic animation or
  // fail outright; fall back to a plain fps duplicate.
  const wantInterpolate = options.interpolate ?? true
  const attempt = async (interpolate: boolean): Promise<{ outputPath: string; loops: number }> => {
    const unitPath = await buildUnit({
      gifPath, workDir, interpolate, pingpong, alphaBackground, maxResolution,
      trimToMax: loopStrategy === "trim",
    })

    if (!needExtend) {
      // "none" or "trim": the unit IS the output.
      const outputPath = join(workDir, "output.mp4")
      await fs.rename(unitPath, outputPath)
      return { outputPath, loops: 1 }
    }

    const unitDuration = pingpong ? probe.durationSeconds * 2 : probe.durationSeconds
    const target = clampTarget(targetDuration)
    const loops = Math.max(
      1,
      Math.min(
        Math.ceil(target / unitDuration),
        Math.max(1, Math.floor(GIF_CLIP_TARGET.targetWindowMax / unitDuration)),
      ),
    )
    if (loops <= 1) {
      const outputPath = join(workDir, "output.mp4")
      await fs.rename(unitPath, outputPath)
      return { outputPath, loops: 1 }
    }
    const outputPath = await loopUnit(unitPath, loops, workDir)
    return { outputPath, loops }
  }

  let outputPath: string
  let loops: number
  let interpolated = wantInterpolate
  try {
    ;({ outputPath, loops } = await attempt(wantInterpolate))
    await assertValidOutput(outputPath)
  } catch (err) {
    if (!wantInterpolate) throw err
    console.warn(`[gifToVideo] interpolated pass failed (${(err as Error).message}); retrying with plain fps`)
    // Clean the failed intermediates so filenames are free to reuse.
    await fs.rm(join(workDir, "output.mp4"), { force: true })
    await fs.rm(join(workDir, "unit.mp4"), { force: true })
    interpolated = false
    ;({ outputPath, loops } = await attempt(false))
    await assertValidOutput(outputPath)
  }

  const outputDurationSeconds = await assertValidOutput(outputPath)
  return {
    outputPath,
    sourceFrames: probe.frames,
    sourceDurationSeconds: probe.durationSeconds,
    outputDurationSeconds,
    loopStrategy,
    loops,
    seamless,
    hadAlpha: probe.hadAlpha,
    interpolated,
    warning: warnings.length ? warnings.join(" ") : undefined,
  }
}
