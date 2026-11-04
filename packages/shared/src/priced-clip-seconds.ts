/**
 * The whole seconds a clip is PRICED at by Video Depth (both providers), Video
 * Mask, Mask Composite and the face mesh: its length rounded up, after ignoring
 * up to {@link CLIP_PRICE_GRACE_SEC} past a whole second.
 *
 * A whole-second cut of a 29.97 or 23.976 fps clip can come out a little long:
 * 12 s is 360 frames, a 12.012 s file. A quote reads the cut, a run measures the
 * file, and both land on the same row through this one rule, wherever those steps
 * are reserved, charged or quoted.
 *
 * It decides the price only. Each step's limits (the 300 s cap, the frame cap)
 * read the clip's real length. Other models round as they always have.
 */

/** How far past a whole second a clip is still priced as that second. */
export const CLIP_PRICE_GRACE_SEC = 0.05

/**
 * Float noise: a length that is arithmetic can land a hair past the edge, and
 * must not round up for it. 1.35 s at 90 fps, priced at the 30 fps basis, is
 * 4.050000000000001: 4, not 5.
 */
const FLOAT_NOISE_SEC = 1e-9

/** At least one second. The caller has checked that `sec` is a real length. */
export function pricedClipSeconds(sec: number): number {
  return Math.max(1, Math.ceil(sec - CLIP_PRICE_GRACE_SEC - FLOAT_NOISE_SEC))
}
