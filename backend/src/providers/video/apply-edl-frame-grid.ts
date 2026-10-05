/**
 * apply-edl's frame grid: THE one place a time on the output timeline becomes
 * a frame index. Every grid boundary of a render — each segment's frame
 * interval, each chunk's seam, each chunk's count and the render's total — is
 * `frameAtMs` of an INTEGER millisecond position at the canvas rate held as a
 * RATIONAL, computed in exact integer arithmetic.
 *
 * Why not `Math.round(seconds * fps)`: two float orders of the same sum land on
 * opposite sides of a half frame. (15.95 + 1.4) · 30 is 520.4999… in floating
 * point and rounds to 520; the exact position, 17 350 ms, is frame 520.5 and
 * rounds to 521. A chunked render whose seam landed on such a tie came out a
 * frame short of its sound (every 11-segment [10, 1] render of the 4K probe).
 * Here the position never passes through a float: integer ms in, the rate as
 * num/den, BigInt in between — the same input gives the same frame however
 * the timeline was summed. The census of the places that must call this is
 * guarded by `__tests__/apply-edl-frame-grid.test.ts`.
 */

/** A frame rate as a reduced fraction: `num / den` frames per second. */
export interface FrameRate {
  readonly num: number
  readonly den: number
}

const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b))

/** A rate as a reduced fraction. */
export function frameRate(num: number, den = 1): FrameRate {
  if (!Number.isSafeInteger(num) || !Number.isSafeInteger(den) || num <= 0 || den <= 0) {
    throw new RangeError(`frame rate ${num}/${den} is not a positive integer fraction`)
  }
  const g = gcd(num, den)
  return { num: num / g, den: den / g }
}

/** The canvas rate the render actually asks ffmpeg for, as a fraction. The
 *  canvas fps is the 0.001-keyed value `pickTargetFps` picks (29.97, 25, 30…)
 *  and the slice writes it as `fps=<that value>`, which ffmpeg reads as the
 *  same decimal — 29.97 is 2997/100, not 30000/1001. Lossless: a value that is
 *  not a whole number of thousandths is refused rather than approximated. */
export function frameRateOf(fps: number): FrameRate {
  const milli = Math.round(fps * 1000)
  if (!(fps > 0) || Math.abs(fps * 1000 - milli) > 1e-6) {
    throw new RangeError(`frame rate ${fps} is not a whole number of thousandths of a frame per second`)
  }
  return frameRate(milli, 1000)
}

/** ⌊a / b⌋ for b > 0 (BigInt `/` truncates toward zero). */
function floorDiv(a: bigint, b: bigint): bigint {
  const q = a / b
  return a % b !== 0n && a < 0n ? q - 1n : q
}

/** The grid frame boundary nearest to `ms` on the output timeline: round(ms ·
 *  rate / 1000), a half frame rounding UP (the `Math.round` convention every
 *  grid count has always used), computed exactly. `ms` must be an integer — an
 *  EDL's times are whole milliseconds once `normalizeEdl` has run, as every
 *  ingress does before a render is queued. */
export function frameAtMs(ms: number, rate: FrameRate): number {
  if (!Number.isSafeInteger(ms)) throw new RangeError(`frame grid position ${ms} ms is not a whole millisecond`)
  const n = BigInt(ms) * BigInt(rate.num)
  const d = BigInt(rate.den) * 1000n
  return Number(floorDiv(2n * n + d, 2n * d))
}
