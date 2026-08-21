/**
 * Slideshow timing planner — pure integer FRAME math on the output grid.
 *
 * Why frames, not seconds: per-slide seconds rounded independently drift —
 * at 100 slides a half-frame each way is seconds of cumulative error, and
 * xfade offsets computed off drifted boundaries corrupt the chain. So the
 * plan converts once to frames, reconciles with LARGEST-REMAINDER so the
 * slot frames sum EXACTLY to the total, and every downstream number
 * (segment lengths, xfade offsets) derives from those integers.
 *
 * The timing model (design sheet, four cases):
 *   A — audio wired            → total = ceil(audio*fps), equal split.
 *   B — some rows pinned       → pins keep their frames, the remainder
 *       splits equally across the autos.
 *   C — all pinned, sum ≠ audio → everything scales proportionally to fill
 *       the audio; the factor is DISCLOSED (`scaleFactor`) — the node and
 *       output_data must surface it. (A pinned sum that exceeds the audio
 *       with autos remaining also lands here: autos get their nominal
 *       perImageDuration and the whole vector scales.)
 *   D — no audio               → total = N × perImageDuration, silent.
 *
 * Transitions consume time from the OUTGOING slide, never the incoming one,
 * so the total stays exact:
 *   segment_0 = slot_0;  segment_i = slot_i + td  (i ≥ 1)
 *   offset_k  = prefix(slot_0..k) − td            (the blend window is the
 *   LAST td of slot k — it eats the outgoing slide's tail)
 *   chain length = seg_0 + Σ(seg_i − td) = Σ slots  — exact by construction.
 */

export const SLIDESHOW_MOTIONS = [
  "none",
  "zoom-in",
  "zoom-out",
  "ken-burns",
  "alternate",
] as const
export type SlideshowMotion = (typeof SLIDESHOW_MOTIONS)[number]

/** Per-slide still motion after resolving `alternate` (index-based flip). */
export function resolveSlideMotion(
  motion: SlideshowMotion,
  index: number,
): "none" | "zoom-in" | "zoom-out" | "ken-burns" {
  if (motion === "alternate") return index % 2 === 0 ? "zoom-in" : "zoom-out"
  return motion
}

export interface SlideshowPlanOptions {
  readonly imageCount: number
  readonly fps: number
  /** Wired audio duration — when present, the audio IS the total length. */
  readonly audioDurationSeconds?: number
  /** Per-slide seconds when NO audio is wired (config field, default 3). */
  readonly perImageDurationSeconds: number
  /** Optional per-slide pinned durations (seconds); null = auto. Length must equal imageCount. */
  readonly overrides?: ReadonlyArray<number | null>
  readonly transitionSeconds: number
  /** Combine-videos transition id; "cut" (or an effective 0-frame duration) = concat, no xfade. */
  readonly transitionId: string
}

export interface SlideshowPlan {
  readonly totalFrames: number
  /** Per-slide visible slot, frames. Sums EXACTLY to totalFrames. */
  readonly slotFrames: readonly number[]
  /** Per-slide RENDER length, frames — slot + td for every slide after the first. */
  readonly segmentFrames: readonly number[]
  /** xfade offsets (seconds), one per boundary; empty for cut. */
  readonly xfadeOffsetsSeconds: readonly number[]
  /** Effective transition length in frames (possibly clamped; 0 = cut). */
  readonly transitionFrames: number
  /** True when the requested transition didn't fit the shortest slot and was clamped. */
  readonly transitionClamped: boolean
  /** Case C disclosure: audio/Σoverrides when proportional scaling was applied. */
  readonly scaleFactor: number | null
  /** No audio wired — the output has no audio track. */
  readonly silent: boolean
}

/**
 * Distribute `total` integer frames across weights, largest-remainder, with
 * every share ≥ minPer. Exact: the shares sum to `total`.
 */
function apportion(total: number, weights: readonly number[], minPer: number): number[] {
  const weightSum = weights.reduce((a, b) => a + b, 0)
  if (weightSum <= 0) throw new Error("slideshow-timing: non-positive weight sum")
  const ideal = weights.map((w) => (total * w) / weightSum)
  const floors = ideal.map((x) => Math.max(minPer, Math.floor(x)))
  let assigned = floors.reduce((a, b) => a + b, 0)
  const shares = [...floors]
  if (assigned > total) {
    // minPer bumps overshot — trim from the largest shares (keeps ≥ minPer).
    let excess = assigned - total
    const order = shares.map((_, i) => i).sort((a, b) => shares[b]! - shares[a]!)
    for (const i of order) {
      if (excess === 0) break
      const give = Math.min(excess, shares[i]! - minPer)
      shares[i]! -= give
      excess -= give
    }
    if (excess > 0) throw new Error("slideshow-timing: audio too short to give every image a frame")
    return shares
  }
  // Hand out the remainder by largest fractional part (stable on ties by index).
  const remainder = total - assigned
  const byFraction = ideal
    .map((x, i) => ({ i, frac: x - Math.floor(x) }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i)
  for (let k = 0; k < remainder; k++) {
    shares[byFraction[k % byFraction.length]!.i]! += 1
  }
  return shares
}

export function computeSlideshowPlan(opts: SlideshowPlanOptions): SlideshowPlan {
  const { imageCount, fps } = opts
  if (!Number.isInteger(imageCount) || imageCount < 2) {
    throw new Error(`slideshow-timing: imageCount must be ≥ 2 (got ${imageCount})`)
  }
  if (opts.overrides !== undefined && opts.overrides.length !== imageCount) {
    throw new Error(
      `slideshow-timing: overrides length ${opts.overrides.length} does not match imageCount ${imageCount}`,
    )
  }

  const silent = opts.audioDurationSeconds === undefined
  let totalFrames: number
  let slotFrames: number[]
  let scaleFactor: number | null = null

  if (silent) {
    // Case D — N × perImageDuration on the frame grid, no audio track.
    const per = Math.max(1, Math.round(opts.perImageDurationSeconds * fps))
    slotFrames = Array.from({ length: imageCount }, () => per)
    totalFrames = per * imageCount
  } else {
    const audio = opts.audioDurationSeconds!
    if (!Number.isFinite(audio) || audio <= 0) {
      throw new Error(`slideshow-timing: invalid audio duration ${audio}`)
    }
    totalFrames = Math.ceil(audio * fps)
    if (totalFrames < imageCount) {
      throw new Error(
        `slideshow-timing: audio too short — ${totalFrames} frames cannot cover ${imageCount} images`,
      )
    }

    // SANITIZE the overrides at this single choke point: the workflow-run
    // path (MCP-written JSON / import / template) is not route-Zod-guarded
    // (pitfall 5b), and a non-numeric entry would NaN-cascade straight
    // through the frame math (NaN comparisons are all false) into
    // `-frames:v NaN`. Anything that isn't a finite positive number is
    // treated as auto (null); a fully-non-numeric array degrades to the
    // equal split rather than a corrupt plan.
    const overrides = (opts.overrides ?? []).map((o) =>
      typeof o === "number" && Number.isFinite(o) && o > 0 ? o : null,
    )
    const hasOverrides = overrides.some((o) => o !== null)
    if (!hasOverrides) {
      // Case A — equal split.
      slotFrames = apportion(totalFrames, Array.from({ length: imageCount }, () => 1), 1)
    } else {
      const pinnedFrames = overrides.map((o) =>
        o === null || o === undefined ? null : Math.max(1, Math.round(o * fps)),
      )
      const autos = pinnedFrames.filter((p) => p === null).length
      const pinnedSum = pinnedFrames.reduce<number>((a, p) => a + (p ?? 0), 0)

      if (autos === 0) {
        // Case C — all pinned. Sum ≠ audio → scale proportionally, disclose.
        if (pinnedSum === totalFrames) {
          slotFrames = pinnedFrames.map((p) => p!)
        } else {
          slotFrames = apportion(totalFrames, pinnedFrames.map((p) => p!), 1)
          const overrideSeconds = overrides.reduce<number>((a, o) => a + (o ?? 0), 0)
          scaleFactor = audio / overrideSeconds
        }
      } else if (pinnedSum < totalFrames) {
        // Case B — pins keep their frames, the remainder splits across autos.
        const remainder = totalFrames - pinnedSum
        if (remainder < autos) {
          throw new Error("slideshow-timing: audio too short for the pinned durations")
        }
        const autoShares = apportion(remainder, Array.from({ length: autos }, () => 1), 1)
        let a = 0
        slotFrames = pinnedFrames.map((p) => (p !== null ? p : autoShares[a++]!))
      } else {
        // Pinned sum ≥ audio with autos remaining — Case C semantics: autos
        // take their nominal perImageDuration and the WHOLE vector scales.
        const nominalAuto = Math.max(1, Math.round(opts.perImageDurationSeconds * fps))
        const weights = pinnedFrames.map((p) => p ?? nominalAuto)
        slotFrames = apportion(totalFrames, weights, 1)
        scaleFactor = totalFrames / weights.reduce((x, y) => x + y, 0)
      }
    }
  }

  // Transitions — consume the outgoing slide's tail; total stays exact.
  const wantsTransition = opts.transitionId !== "cut" && opts.transitionSeconds > 0
  let transitionFrames = wantsTransition ? Math.round(opts.transitionSeconds * fps) : 0
  let transitionClamped = false
  if (transitionFrames > 0) {
    const shortestSlot = Math.min(...slotFrames)
    const maxTd = Math.max(0, shortestSlot - 1)
    if (transitionFrames > maxTd) {
      transitionFrames = maxTd
      transitionClamped = true
    }
  }

  // Plan integrity — the numbers below become ffmpeg argv (`-frames:v`,
  // xfade offsets); a non-positive-integer slot means the math above was fed
  // garbage that slipped every guard. Fail loudly here, not inside ffmpeg.
  for (const f of slotFrames) {
    if (!Number.isInteger(f) || f < 1) {
      throw new Error(`slideshow-timing: internal error — invalid slot frame count ${f}`)
    }
  }

  const segmentFrames =
    transitionFrames > 0
      ? slotFrames.map((s, i) => (i === 0 ? s : s + transitionFrames))
      : [...slotFrames]

  const xfadeOffsetsSeconds: number[] = []
  if (transitionFrames > 0) {
    let prefix = 0
    for (let k = 0; k < slotFrames.length - 1; k++) {
      prefix += slotFrames[k]!
      xfadeOffsetsSeconds.push((prefix - transitionFrames) / fps)
    }
  }

  return {
    totalFrames,
    slotFrames,
    segmentFrames,
    xfadeOffsetsSeconds,
    transitionFrames,
    transitionClamped,
    scaleFactor,
    silent,
  }
}
