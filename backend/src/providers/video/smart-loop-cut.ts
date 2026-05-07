/**
 * Smart loop cut — finds the optimal end-frame to trim a clip at so the
 * resulting last frame is as similar as possible to the first frame, then
 * cuts there. Output loops cleaner than a hard time-based trim because the
 * seam between last → first is empirically minimised rather than guessed.
 *
 * Algorithm:
 *   1. ffprobe → fps + total frame count.
 *   2. Single ffmpeg pass extracts frame 0 + the last `lookbackFrames`
 *      candidates as PNGs (saves N - 1 ffmpeg invocations vs per-frame
 *      extraction).
 *   3. For each candidate, decode pixels via sharp and compute PSNR against
 *      frame 0. Higher PSNR = closer match.
 *   4. Re-encode the source up to (chosen-frame-index + 1) frames using
 *      `-vframes`.
 *
 * Use cases:
 *   - VEO 3.1 first+last-frame mode produces a tail dissolve that
 *     `autoLoopTrim` strips at a fixed 8-frame offset; this helper finds
 *     the actually-best cut empirically and beats the fixed offset on
 *     stochastic VEO outputs.
 *   - Loop-Video preprocessing — clip the input to its cleanest loop
 *     boundary BEFORE concatenating N copies, so the N-1 internal seams
 *     are all clean too.
 */
import { join } from "node:path"
import { promises as fs } from "node:fs"
import sharp from "sharp"
import {
  downloadFile,
  runFfmpeg,
  runFfprobe,
  createWorkDir,
  cleanupWorkDir,
} from "./ffmpeg-utils.js"

export interface SmartLoopCutOptions {
  readonly videoUrl: string
  /** How many trailing frames to evaluate as candidate end-frames.
   *  Default 16 — covers the typical VEO tail-dissolve range plus
   *  a few extra frames of slack. Cap at 64 for runtime sanity. */
  readonly lookbackFrames?: number
}

export interface SmartLoopCutResult {
  readonly videoPath: string
  /** 0-indexed frame number we trimmed to. Output frame count = chosenFrameIndex + 1. */
  readonly chosenFrameIndex: number
  /** PSNR (dB) between the chosen end-frame and frame 0. Higher is better.
   *  >30 ≈ visually identical · 20–30 ≈ noticeable diff · <20 ≈ broken seam. */
  readonly psnr: number
  /** Total frames in the source. Useful for telemetry — how many slop frames we cut. */
  readonly sourceFrameCount: number
  /** Source fps (as reported by ffprobe). */
  readonly fps: number
}

/**
 * Pick the trailing frame closest to frame 0 (by PSNR) and trim there.
 * Single ffmpeg pass for extraction; one sharp+pixel-loop per candidate
 * for comparison (no further ffmpeg invocations).
 */
export async function smartLoopCut(
  options: SmartLoopCutOptions,
): Promise<SmartLoopCutResult> {
  const lookback = Math.max(1, Math.min(options.lookbackFrames ?? 16, 64))
  const workDir = await createWorkDir("smart-loop-cut")

  try {
    const inputPath = join(workDir, "input.mp4")
    const outputPath = join(workDir, "output.mp4")

    console.log(`[smartLoopCut] Downloading video from ${options.videoUrl}`)
    await downloadFile(options.videoUrl, inputPath)

    const { fps, frameCount } = await probeFpsAndFrameCount(inputPath)
    if (frameCount < lookback + 2) {
      throw new Error(
        `Source too short for smart loop cut: ${frameCount} frames, need ≥ ${lookback + 2}`,
      )
    }

    // Indices to extract: frame 0 + the last `lookback` frames.
    // Express as ffmpeg `select` filter alternatives.
    const candidateIndices = Array.from(
      { length: lookback },
      (_, i) => frameCount - lookback + i,
    )
    const allIndices = [0, ...candidateIndices]
    const selectExpr = allIndices.map((i) => `eq(n\\,${i})`).join("+")

    const framesPattern = join(workDir, "frame_%04d.png")
    await runFfmpeg([
      "-y", "-i", inputPath,
      "-vf", `select='${selectExpr}'`,
      "-vsync", "0",
      "-frames:v", String(allIndices.length),
      framesPattern,
    ])

    // The pattern emits files numbered 1-based in the order frames appeared.
    // Index 0 in `allIndices` → frame_0001.png; allIndices[i] → frame_(i+1).png.
    const frame0Path = join(workDir, "frame_0001.png")
    const frame0Pixels = await sharp(frame0Path).raw().toBuffer({ resolveWithObject: true })

    let bestIdx = candidateIndices.length - 1
    let bestPsnr = -Infinity
    for (let i = 0; i < candidateIndices.length; i++) {
      const candPath = join(workDir, `frame_${String(i + 2).padStart(4, "0")}.png`)
      const psnr = await psnrAgainst(frame0Pixels.data, frame0Pixels.info, candPath)
      if (psnr > bestPsnr) {
        bestPsnr = psnr
        bestIdx = i
      }
    }

    const chosenFrameIndex = candidateIndices[bestIdx]
    // Output exactly chosenFrameIndex + 1 frames. `-vframes` is robust here —
    // works regardless of variable frame rate.
    await runFfmpeg([
      "-y", "-i", inputPath,
      "-vframes", String(chosenFrameIndex + 1),
      "-c:v", "libx264", "-pix_fmt", "yuv420p",
      "-preset", "fast", "-crf", "20",
      "-c:a", "copy",
      "-movflags", "+faststart",
      outputPath,
    ])

    console.log(
      `[smartLoopCut] Source ${frameCount} frames @ ${fps}fps; ` +
        `chose frame ${chosenFrameIndex} (cut ${frameCount - chosenFrameIndex - 1} trailing frames, PSNR ${bestPsnr.toFixed(2)})`,
    )

    return {
      videoPath: outputPath,
      chosenFrameIndex,
      psnr: bestPsnr,
      sourceFrameCount: frameCount,
      fps,
    }
  } catch (err) {
    await cleanupWorkDir(workDir)
    throw err
  }
}

async function probeFpsAndFrameCount(
  filePath: string,
): Promise<{ fps: number; frameCount: number }> {
  // -count_packets is faster than -count_frames and accurate enough for
  // mp4. Fall back to duration × fps if the count probe returns 0/N/A
  // (some containers don't expose nb_read_packets).
  const out = await runFfprobe([
    "-v", "error",
    "-select_streams", "v:0",
    "-count_packets",
    "-show_entries", "stream=r_frame_rate,nb_read_packets,duration",
    "-of", "csv=p=0",
    filePath,
  ])
  const [fpsExpr, packetsStr, durationStr] = out.trim().split(",")
  const fps = parseFractionalFps(fpsExpr)
  let frameCount = parseInt(packetsStr ?? "", 10)
  if (!Number.isFinite(frameCount) || frameCount <= 0) {
    const duration = parseFloat(durationStr ?? "0")
    frameCount = Math.round(duration * fps)
  }
  if (!Number.isFinite(fps) || fps <= 0 || frameCount <= 0) {
    throw new Error(
      `Could not determine fps/frame-count: fpsExpr="${fpsExpr}" packets="${packetsStr}" duration="${durationStr}"`,
    )
  }
  return { fps, frameCount }
}

function parseFractionalFps(expr: string | undefined): number {
  if (!expr) return NaN
  if (expr.includes("/")) {
    const [num, den] = expr.split("/").map((s) => parseFloat(s))
    return den ? num / den : NaN
  }
  return parseFloat(expr)
}

async function psnrAgainst(
  refPixels: Buffer,
  refInfo: sharp.OutputInfo,
  candPath: string,
): Promise<number> {
  // sharp returns raw RGB(A) at the source's bit depth. PNG from ffmpeg's
  // libx264-decoded frames is 8-bit RGB, so MSE is over uint8 squared
  // differences. Same width/height/channels as ref by construction.
  const cand = await sharp(candPath).raw().toBuffer({ resolveWithObject: true })
  if (
    cand.info.width !== refInfo.width ||
    cand.info.height !== refInfo.height ||
    cand.info.channels !== refInfo.channels
  ) {
    throw new Error(
      `PSNR shape mismatch: ref ${refInfo.width}×${refInfo.height}×${refInfo.channels} ` +
        `vs cand ${cand.info.width}×${cand.info.height}×${cand.info.channels}`,
    )
  }
  const a = refPixels
  const b = cand.data
  let sumSq = 0
  const len = Math.min(a.length, b.length)
  for (let i = 0; i < len; i++) {
    const d = a[i] - b[i]
    sumSq += d * d
  }
  const mse = sumSq / len
  if (mse === 0) return Infinity
  return 10 * Math.log10((255 * 255) / mse)
}
