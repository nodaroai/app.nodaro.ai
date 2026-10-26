/**
 * A trend's face mask marks (decided 2026-10-26), the wire both the backend
 * (the trend's schema, the internal `mask-erase` job) and the trend builder
 * (the marks editor) read. Internal only: not an Apache grant — the
 * platform's own trend tooling, not a public API.
 */

/**
 * A box on a face mask, over a range of frames: every connected white region
 * of the mask whose bounding-box CENTRE lies inside the box, on a frame from
 * `fromFrame` to `toFrame`, is dropped whole (the same test Video Mask's
 * `zone` applies, the other way round; never a paint of pixels).
 *
 * - `fromFrame` / `toFrame`: frames of the source clip, 0-based, both
 *   included (`fromFrame ≤ toFrame`).
 * - `leftPct` / `topPct` / `rightPct` / `bottomPct`: the box's edges, each a %
 *   of the frame measured from its left (`leftPct`, `rightPct`) or top
 *   (`topPct`, `bottomPct`) edge, `left < right` and `top < bottom`.
 */
export interface MaskEraseBox {
  fromFrame: number
  toFrame: number
  leftPct: number
  topPct: number
  rightPct: number
  bottomPct: number
}

/**
 * What a face mask mark says about the faces in its box (`FaceMaskMark.label`):
 * `"erased"` = left unmasked. The only label today; a later kind of mark adds
 * its own.
 */
export const CAST_SWAP_FACE_MASK_MARK_LABELS = ["erased"] as const
export type CastSwapFaceMaskMarkLabel = (typeof CAST_SWAP_FACE_MASK_MARK_LABELS)[number]

/**
 * A labelled box on a trend's face mask (`faceMasking.marks`): a
 * `MaskEraseBox` with what it says about the faces centred in it. `"erased"`:
 * those faces are left out of the mask.
 */
export interface FaceMaskMark extends MaskEraseBox {
  label: CastSwapFaceMaskMarkLabel
}

/** `faceMasking.marks`' limits: at most `maxMarks` marks, each edge within `edgePct` (inclusive). */
export const CAST_SWAP_FACE_MASK_MARK_LIMITS = {
  maxMarks: 50,
  edgePct: [0, 100],
} as const
