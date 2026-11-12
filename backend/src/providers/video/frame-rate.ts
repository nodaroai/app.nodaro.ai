/**
 * The one frame-rate rule every probe reads a rate by, in a leaf with no
 * imports, so a module that only reads a probe (`matched-encode.ts`) can use
 * it without importing `ffmpeg-utils.ts` (child processes, the network, the
 * storage client). `ffmpeg-utils.ts` re-exports it; either import path is the
 * same function.
 */

/**
 * ffprobe reports a frame rate as the rational string "num/den" ("30000/1001").
 * A stream with no usable rate reports "0/0" — and a still-image or malformed
 * stream can report anything at all — so every unusable form answers `undefined`
 * rather than a made-up number: the caller decides the fallback.
 */
export function parseFrameRate(value: unknown): number | undefined {
  if (typeof value !== "string") return undefined
  const [num, den] = value.trim().split("/")
  const n = Number(num)
  const d = den === undefined ? 1 : Number(den)
  if (!Number.isFinite(n) || !Number.isFinite(d) || d === 0 || n <= 0) return undefined
  const fps = n / d
  return Number.isFinite(fps) && fps > 0 ? fps : undefined
}

/**
 * How far the clip's AVERAGE rate may sit from its nominal base rate before the
 * source counts as variable-frame-rate, as a fraction of the larger of the two.
 */
const VFR_RATE_TOLERANCE = 0.1

/**
 * The clip's CONSTANT frame rate, or `undefined` when it has none.
 *
 * `avg_frame_rate` is what the clip actually played at, `r_frame_rate` the
 * container's nominal base rate. When only one parses, that is the best answer
 * available. When both do and they DISAGREE by more than VFR_RATE_TOLERANCE, the
 * source is variable-frame-rate: neither number describes a constant rate (a
 * sparse screen recording reports an average of ~6 against a base of 60), so
 * re-encoding at either one is wrong — a bursty source rendered at its low
 * average decimates the real motion. Report no rate and let the caller fall back.
 */
export function constantFrameRate(avg: number | undefined, nominal: number | undefined): number | undefined {
  if (avg === undefined) return nominal
  if (nominal === undefined) return avg
  const spread = Math.abs(avg - nominal) / Math.max(avg, nominal)
  return spread > VFR_RATE_TOLERANCE ? undefined : avg
}
