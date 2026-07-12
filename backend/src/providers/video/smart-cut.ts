/**
 * Smart cut — finds the best boundary between two consecutive clips by
 * frame similarity. Searches the last `framesFromPrev` frames of the
 * previous clip and the first `framesFromNext` frames of the next clip,
 * computes PSNR for every pair, and picks the closest match. The previous
 * clip is trimmed to END on the matched frame; the next clip is trimmed to
 * start AFTER its matched frame — the near-identical frame plays exactly
 * once, so motion continues across the cut instead of stuttering.
 *
 * Built for continuation workflows (clip B generated from clip A's last
 * frame via i2v "extend"): the model re-renders a similar opening moment,
 * and a fixed per-clip frame trim only ever guesses where the overlap is.
 * This is the two-clip generalization of smart-loop-cut (same PSNR
 * machinery), which matches a clip's tail against its OWN first frame.
 *
 * Both inputs are expected to share resolution (combine-videos runs this
 * after normalizeVideoForCombine); frames are downscaled to a small
 * comparison size first, which speeds the pixel loops up ~40× and adds
 * noise robustness without changing the ranking.
 */
import { join } from "node:path"
import sharp from "sharp"
import { runFfmpeg, createWorkDir, cleanupWorkDir } from "./ffmpeg-utils.js"
import { probeFpsAndFrameCount } from "./smart-loop-cut.js"

/** Width frames are downscaled to before PSNR comparison (height follows
 *  aspect, forced even). Small enough to make X*Y pixel loops trivial,
 *  large enough that ranking is stable. */
const COMPARE_WIDTH = 192

export interface SmartCutBoundary {
  /** Frames to drop from the END of the previous clip. The matched frame
   *  itself is KEPT as the clip's new last frame. */
  readonly trimEndFrames: number
  /** Frames to drop from the START of the next clip. The matched
   *  near-identical frame is dropped too (the previous clip already ends
   *  on it), so this is matchIndex + 1. */
  readonly trimStartFrames: number
  /** PSNR (dB) of the chosen pair. >30 ≈ visually identical,
   *  20–30 ≈ close, <20 ≈ no real overlap found (best effort). */
  readonly psnr: number
}

/**
 * Pure index math, split out for tests: map the best (prev, next) match to
 * per-clip trim counts. `bestPrevOffset` counts from the end of the search
 * window (0 = very last frame); `bestNextIndex` counts from the start of
 * the next clip (0 = very first frame).
 */
export function boundaryTrimsFromMatch(
  bestPrevOffset: number,
  bestNextIndex: number,
): { trimEndFrames: number; trimStartFrames: number } {
  return {
    trimEndFrames: bestPrevOffset,
    trimStartFrames: bestNextIndex + 1,
  }
}

async function decodeRaw(path: string): Promise<{ data: Buffer; width: number; height: number; channels: number }> {
  const { data, info } = await sharp(path).raw().toBuffer({ resolveWithObject: true })
  return { data, width: info.width, height: info.height, channels: info.channels }
}

function psnrBetween(
  a: { data: Buffer; width: number; height: number; channels: number },
  b: { data: Buffer; width: number; height: number; channels: number },
): number {
  if (a.width !== b.width || a.height !== b.height || a.channels !== b.channels) {
    throw new Error(
      `smart-cut PSNR shape mismatch: ${a.width}×${a.height}×${a.channels} vs ${b.width}×${b.height}×${b.channels}`,
    )
  }
  let sumSq = 0
  const len = Math.min(a.data.length, b.data.length)
  for (let i = 0; i < len; i++) {
    const d = a.data[i]! - b.data[i]!
    sumSq += d * d
  }
  const mse = sumSq / len
  if (mse === 0) return Infinity
  return 10 * Math.log10((255 * 255) / mse)
}

/**
 * Search the boundary between `prevPath` (tail) and `nextPath` (head) for
 * the most similar frame pair. Returns the per-clip trims that cut there.
 * Windows are clamped so each clip keeps at least 2 frames.
 */
export async function findSmartCutBoundary(
  prevPath: string,
  nextPath: string,
  framesFromPrev: number,
  framesFromNext: number,
): Promise<SmartCutBoundary> {
  const workDir = await createWorkDir("smart-cut")
  try {
    const [prevInfo, nextInfo] = await Promise.all([
      probeFpsAndFrameCount(prevPath),
      probeFpsAndFrameCount(nextPath),
    ])

    // Keep at least 2 frames of each clip no matter what was requested.
    const windowPrev = Math.max(1, Math.min(framesFromPrev, prevInfo.frameCount - 2))
    const windowNext = Math.max(1, Math.min(framesFromNext, nextInfo.frameCount - 2))

    // Extract both windows as downscaled PNGs (one ffmpeg pass per clip).
    const prevPattern = join(workDir, "prev_%04d.png")
    await runFfmpeg([
      "-y", "-i", prevPath,
      "-vf", `select='gte(n\\,${prevInfo.frameCount - windowPrev})',scale=${COMPARE_WIDTH}:-2`,
      "-vsync", "0",
      "-frames:v", String(windowPrev),
      prevPattern,
    ])
    const nextPattern = join(workDir, "next_%04d.png")
    await runFfmpeg([
      "-y", "-i", nextPath,
      "-vf", `select='lt(n\\,${windowNext})',scale=${COMPARE_WIDTH}:-2`,
      "-vsync", "0",
      "-frames:v", String(windowNext),
      nextPattern,
    ])

    // Decode every frame once, then compare all pairs in memory.
    // prev_0001.png is the FIRST frame of the tail window (oldest);
    // prev_<windowPrev>.png is the clip's very last frame.
    const prevFrames = await Promise.all(
      Array.from({ length: windowPrev }, (_, i) =>
        decodeRaw(join(workDir, `prev_${String(i + 1).padStart(4, "0")}.png`)),
      ),
    )
    const nextFrames = await Promise.all(
      Array.from({ length: windowNext }, (_, i) =>
        decodeRaw(join(workDir, `next_${String(i + 1).padStart(4, "0")}.png`)),
      ),
    )

    let bestPsnr = -Infinity
    // Defaults = plain cut (keep everything up to the very last frame,
    // drop nothing from the next clip) if every comparison somehow fails.
    let bestPrevOffset = 0
    let bestNextIndex = -1
    for (let i = 0; i < prevFrames.length; i++) {
      // i counts window frames oldest→newest; offset from clip end:
      const prevOffset = windowPrev - 1 - i
      for (let j = 0; j < nextFrames.length; j++) {
        const psnr = psnrBetween(prevFrames[i]!, nextFrames[j]!)
        if (psnr > bestPsnr) {
          bestPsnr = psnr
          bestPrevOffset = prevOffset
          bestNextIndex = j
        }
      }
    }

    const trims = boundaryTrimsFromMatch(bestPrevOffset, bestNextIndex)
    console.log(
      `[smartCut] Best pair: prev end-${bestPrevOffset} ↔ next +${bestNextIndex} ` +
        `(PSNR ${bestPsnr === Infinity ? "inf" : bestPsnr.toFixed(2)}dB) → ` +
        `trimEnd=${trims.trimEndFrames}, trimStart=${trims.trimStartFrames}`,
    )
    return { ...trims, psnr: bestPsnr }
  } finally {
    await cleanupWorkDir(workDir)
  }
}
