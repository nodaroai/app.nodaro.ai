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
 *   4. Re-encode the source up to (but EXCLUDING) the chosen frame using
 *      `-vframes <chosenFrameIndex>`. Excluding the match means the loop
 *      boundary is f(K-1) → f0 (continuous motion). Including it would
 *      produce a 1-frame freeze since the matching frame is by selection
 *      visually ≈ frame 0.
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
import { colourTagArgs, probeMatched, type MatchedProbe } from "./matched-encode.js"
import { isHdr } from "./extend-stitch-args.js"
import { PREVIEW_SEC_PER_4K_SEC } from "./browser-safe-preview.js"
import { UHD_CANVAS } from "./ffmpeg-memory-model.js"
import { DEFAULT_FFMPEG_TIMEOUT_MS } from "./ffmpeg-timeouts.js"

/**
 * The precise cut's picture encode. An SDR source: 8-bit H.264, exactly as it
 * always was. An HDR source (HLG or PQ, `isHdr` on the probed file; Kling 4.0
 * HDR): 10-bit HEVC, tagged `hvc1` for players, with the source's own colour
 * signalling (`colourTagArgs`: BT.2020, HLG), so the cut keeps its HDR and the
 * store keeps it as the original beside a browser-safe preview (decided
 * 2026-11-25: an HDR run is never charged for an 8-bit file). Pure, so its
 * choice is tested on probes.
 */
export function loopCutPictureArgs(probe: MatchedProbe): string[] {
  if (!isHdr(probe)) return ["-c:v", "libx264", "-pix_fmt", "yuv420p", "-preset", "fast", "-crf", "20"]
  return [
    "-c:v", "libx265", "-pix_fmt", "yuv420p10le", "-tag:v", "hvc1", "-preset", "fast", "-crf", "20",
    ...colourTagArgs(probe),
    // The same signalling in the HEVC stream itself (its VUI), where players read it.
    ...x265ColourParams(probe),
  ]
}

/** x265's VUI colour fields from the probed tags; a tag the probe did not read is left out. */
function x265ColourParams(probe: MatchedProbe): string[] {
  const read = (v: string | undefined) => (v && v !== "unknown" && v !== "reserved" ? v : undefined)
  const params = [
    ["colorprim", read(probe.colorPrimaries)],
    ["transfer", read(probe.colorTransfer)],
    ["colormatrix", read(probe.colorSpace)],
  ].flatMap(([k, v]) => (v ? [`${k}=${v}`] : []))
  return params.length > 0 ? ["-x265-params", params.join(":")] : []
}

/** Wall seconds the HDR cut's 10-bit HEVC encode is given per second of 4K picture (twice the preview's `PREVIEW_SEC_PER_4K_SEC`: x265 is slower than x264). */
export const LOOP_CUT_HDR_SEC_PER_4K_SEC = 2 * PREVIEW_SEC_PER_4K_SEC
/** The longest the HDR cut's encode is given: 15 minutes, which keeps a 30 s 4K run inside its recovery kind's 75 minutes. */
export const LOOP_CUT_HDR_MAX_TIMEOUT_MS = 15 * 60 * 1000

/**
 * How long the precise cut's encode may run. An SDR source: the default ffmpeg
 * limit, as always (`undefined`). An HDR source (the 10-bit HEVC encode):
 * {@link LOOP_CUT_HDR_SEC_PER_4K_SEC} per second of picture, scaled by its size
 * against 4K, never below the default limit and never above
 * {@link LOOP_CUT_HDR_MAX_TIMEOUT_MS} — the preview encode's rule
 * (`previewTimeoutMs`). A cut that runs out of time keeps the untrimmed clip
 * and refunds the trim, as any failed cut does.
 */
export function loopCutTimeoutMs(probe: MatchedProbe): number | undefined {
  if (!isHdr(probe)) return undefined
  const seconds = probe.videoDurationSec ?? probe.durationSec
  if (seconds === undefined || !(seconds > 0)) return LOOP_CUT_HDR_MAX_TIMEOUT_MS
  const w = probe.width ?? UHD_CANVAS.width
  const h = probe.height ?? UHD_CANVAS.height
  const scale = (w * h) / (UHD_CANVAS.width * UHD_CANVAS.height)
  const wanted = Math.ceil(seconds * LOOP_CUT_HDR_SEC_PER_4K_SEC * scale * 1000)
  return Math.min(LOOP_CUT_HDR_MAX_TIMEOUT_MS, Math.max(DEFAULT_FFMPEG_TIMEOUT_MS, wanted))
}

export interface SmartLoopCutOptions {
  readonly videoUrl: string
  /** How many trailing frames to evaluate as candidate end-frames.
   *  Default 16 — covers the typical VEO tail-dissolve range plus
   *  a few extra frames of slack. Cap at 64 for runtime sanity. */
  readonly lookbackFrames?: number
  /** When true, the output is encoded with `-an` (no audio). Default
   *  false — source audio is copied through up to the chosen cut. */
  readonly outputSilent?: boolean
  /** "precise" — any-frame candidates + libx264 re-encode (default; current
   *  behavior; frame-precise; slight quality loss).
   *  "lossless" — keyframe-only candidates + stream-copy (byte-perfect
   *  quality; cut snaps to nearest keyframe; supports any resolution at
   *  near-zero memory cost). */
  readonly quality?: "lossless" | "precise"
  /** Called with the downloaded input once it is on disk, before anything is
   *  probed or encoded: a Trim / Loop job's charge check (the render refuses a
   *  file longer than its run was priced for). Absent for every other caller. */
  readonly chargeCheck?: (localPaths: readonly string[]) => Promise<void>
}

export interface SmartLoopCutResult {
  readonly videoPath: string
  /** 0-indexed frame at which the loop-match was found — also the cut
   *  point. The output INCLUDES frames 0..chosenFrameIndex-1 and EXCLUDES
   *  the matching frame (so the loop boundary is seamless). Output frame
   *  count = chosenFrameIndex. */
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
  const requestedLookback = Math.max(1, Math.min(options.lookbackFrames ?? 16, 64))
  const workDir = await createWorkDir("smart-loop-cut")

  try {
    const inputPath = join(workDir, "input.mp4")
    const outputPath = join(workDir, "output.mp4")

    console.log(`[smartLoopCut] Downloading video from ${options.videoUrl}`)
    await downloadFile(options.videoUrl, inputPath)
    await options.chargeCheck?.([inputPath])

    const { fps, frameCount } = await probeFpsAndFrameCount(inputPath)

    // Need at least 3 frames: frame 0 (reference) + 2 candidates (so the
    // search has any meaning — picking from a single candidate is a no-op).
    if (frameCount < 3) {
      throw new Error(
        `Source too short for smart loop cut: ${frameCount} frame(s). ` +
          `Use the "Time" or "Frames" trim mode instead, or skip trimming entirely.`,
      )
    }

    // Auto-clamp lookback to the available trailing window. Better than
    // failing the whole job for a short clip — the user gets a result that
    // honours the spirit of the request even when the source is too short
    // for the full requested search depth.
    const lookback = Math.min(requestedLookback, frameCount - 2)
    if (lookback < requestedLookback) {
      console.warn(
        `[smartLoopCut] Source has ${frameCount} frames; clamping lookback ${requestedLookback}→${lookback}`,
      )
    }

    // === lossless mode (keyframe-only candidates + stream-copy) ===
    // When quality === "lossless", search the trailing window for KEYFRAMES
    // only and stream-copy the cut. Output is byte-perfect (no re-encode).
    // Trade-off: cut snaps to nearest keyframe, so accuracy is keyframe-spaced
    // (typically 1–4s with default GOP). If no keyframe lands in the lookback
    // window, fall through to the precise re-encode path below.
    //
    // Why packet timestamps and not frame indices: with B-frames, decode
    // order ≠ display order, and `coded_picture_number` doesn't align with
    // `-vframes K` byte position. Packet `pts_time` is stable.
    const quality = options.quality ?? "precise"
    if (quality === "lossless") {
      const pktOut = await runFfprobe([
        "-v", "error",
        "-select_streams", "v:0",
        "-show_packets",
        "-show_entries", "packet=pts_time,flags",
        "-of", "csv=p=0",
        inputPath,
      ])
      const keyframeTimes = pktOut
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.length > 0)
        .map((line) => {
          const [pts, flags] = line.split(",")
          return { pts: parseFloat(pts ?? ""), isKey: (flags ?? "").startsWith("K") }
        })
        .filter((p) => p.isKey && Number.isFinite(p.pts))
        .map((p) => p.pts)

      const totalDuration = frameCount / fps
      const lookbackSec = lookback / fps
      const windowStart = totalDuration - lookbackSec
      const candidates = keyframeTimes.filter((t) => t >= windowStart && t < totalDuration)

      if (candidates.length === 0) {
        console.warn(
          `[smartLoopCut] No keyframes in last ${lookbackSec.toFixed(2)}s; ` +
            `falling back to precise mode for ${options.videoUrl}`,
        )
        // Fall through to precise mode below.
      } else {
        // Extract frame 0 once for PSNR comparison
        const frame0Path = join(workDir, "frame_0.png")
        await runFfmpeg(["-y", "-i", inputPath, "-frames:v", "1", frame0Path])
        const frame0Pixels = await sharp(frame0Path)
          .raw()
          .toBuffer({ resolveWithObject: true })

        let bestIdx = 0
        let bestPsnr = -Infinity
        for (let i = 0; i < candidates.length; i++) {
          const candPath = join(workDir, `cand_${i}.png`)
          await runFfmpeg([
            "-y", "-ss", String(candidates[i]),
            "-i", inputPath,
            "-frames:v", "1",
            candPath,
          ])
          const psnr = await psnrAgainst(frame0Pixels.data, frame0Pixels.info, candPath)
          if (psnr > bestPsnr) {
            bestPsnr = psnr
            bestIdx = i
          }
        }
        const chosenPts = candidates[bestIdx]!

        const audioArgs = options.outputSilent ? ["-an"] : ["-c:a", "copy"]
        await runFfmpeg([
          "-y", "-i", inputPath,
          "-t", String(chosenPts),
          "-c:v", "copy",
          ...audioArgs,
          "-movflags", "+faststart",
          outputPath,
        ])

        const chosenFrameIndex = Math.round(chosenPts * fps)
        console.log(
          `[smartLoopCut] (lossless) Source ${frameCount} frames @ ${fps}fps; ` +
            `cut at pts ${chosenPts}s (frame ~${chosenFrameIndex}, ` +
            `dropped ${frameCount - chosenFrameIndex} trailing, PSNR ${bestPsnr.toFixed(2)})`,
        )

        return {
          videoPath: outputPath,
          chosenFrameIndex,
          psnr: bestPsnr,
          sourceFrameCount: frameCount,
          fps,
        }
      }
    }

    // === precise mode (or lossless fallback) — EXISTING CODE ===
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
      "-fps_mode", "passthrough",
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
    // Output `chosenFrameIndex` frames (indices 0..chosenFrameIndex-1).
    // The chosen frame itself is EXCLUDED so the loop boundary is
    // f(K-1) → f0 (continuous motion), not f(K) → f0 which would be a
    // 1-frame freeze since f(K) ≈ f0 by selection. `-vframes` works
    // regardless of variable frame rate.
    const audioArgs = options.outputSilent ? ["-an"] : ["-c:a", "copy"]
    const sourceProbe = await probeMatched(inputPath)
    await runFfmpeg([
      "-y", "-i", inputPath,
      "-vframes", String(chosenFrameIndex),
      ...loopCutPictureArgs(sourceProbe),
      ...audioArgs,
      "-movflags", "+faststart",
      outputPath,
    ], loopCutTimeoutMs(sourceProbe))

    console.log(
      `[smartLoopCut] Source ${frameCount} frames @ ${fps}fps; ` +
        `cut at frame ${chosenFrameIndex} (kept ${chosenFrameIndex} frames, ` +
        `dropped ${frameCount - chosenFrameIndex} trailing, PSNR ${bestPsnr.toFixed(2)})`,
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

export async function probeFpsAndFrameCount(
  filePath: string,
): Promise<{ fps: number; frameCount: number }> {
  // Use -count_frames + nb_read_frames (decodes the stream; accurate)
  // instead of -count_packets, which under-reports on fragmented MP4s
  // (e.g. VEO 3.1 outputs report ~7 packets for an 8s clip with ~192
  // actual frames because the fragments aren't flat-packet streams).
  // JSON output avoids any CSV field-order ambiguity.
  const out = await runFfprobe([
    "-v", "error",
    "-select_streams", "v:0",
    "-count_frames",
    "-show_entries", "stream=r_frame_rate,nb_read_frames,duration",
    "-of", "json",
    filePath,
  ])
  const parsed = JSON.parse(out) as {
    streams?: Array<{ r_frame_rate?: string; nb_read_frames?: string; duration?: string }>
  }
  const stream = parsed.streams?.[0]
  if (!stream) {
    throw new Error("ffprobe returned no video stream for smart-loop-cut probe")
  }
  const fpsExpr = stream.r_frame_rate
  const fps = parseFractionalFps(fpsExpr)
  let frameCount = parseInt(stream.nb_read_frames ?? "", 10)
  if (!Number.isFinite(frameCount) || frameCount <= 0) {
    const duration = parseFloat(stream.duration ?? "0")
    frameCount = Math.round(duration * fps)
  }
  if (!Number.isFinite(fps) || fps <= 0 || frameCount <= 0) {
    throw new Error(
      `Could not determine fps/frame-count: fpsExpr="${fpsExpr}" frames="${stream.nb_read_frames}" duration="${stream.duration}"`,
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
