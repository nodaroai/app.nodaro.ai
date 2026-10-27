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
 * What a face mask mark says (`FaceMaskMark.label`), on every run:
 *
 * - `"erased"`: the faces in its box are left unmasked.
 * - `"main"` (a keep-people trend clip only): the person in its box is the
 *   main character, the only one kept as filmed when any `"main"` mark exists.
 */
export const CAST_SWAP_FACE_MASK_MARK_LABELS = ["erased", "main"] as const
export type CastSwapFaceMaskMarkLabel = (typeof CAST_SWAP_FACE_MASK_MARK_LABELS)[number]

/**
 * A slot mark's label (decided 2026-10-27): the faces in its box are the
 * person of the trend's optional person slot `slot` (a `TrendSlot.key`). They
 * are left unmasked only when a run leaves that person empty (it then stays
 * as in the clip), through the trend's per-person mask variants; they never
 * shape the base mask.
 */
export interface FaceMaskSlotLabel {
  slot: string
}

/** What a face mask mark says about the faces centred in its box: `"erased"`, `"main"`, or `{ slot }`. */
export type FaceMaskMarkLabel = CastSwapFaceMaskMarkLabel | FaceMaskSlotLabel

/**
 * A labelled box on a trend's face mask (`faceMasking.marks`): a
 * `MaskEraseBox` with what it says about the faces centred in it. `"erased"`:
 * those faces are left out of the mask. `{ slot }`: those faces are that
 * optional person's, left out only of the mask a run that leaves the person
 * empty is sent.
 */
export interface FaceMaskMark extends MaskEraseBox {
  label: FaceMaskMarkLabel
}

/** Whether a mark is a `"main"` one (a keep-people trend clip's main character). */
export function isMainFaceMaskMark(mark: Pick<FaceMaskMark, "label">): boolean {
  return mark.label === "main"
}

/** Whether a mark is an `"erased"` one (every run). */
export function isErasedFaceMaskMark(mark: Pick<FaceMaskMark, "label">): boolean {
  return mark.label === "erased"
}

/** The slot a slot mark names, or null for an `"erased"` or `"main"` mark. */
export function faceMaskMarkSlot(mark: Pick<FaceMaskMark, "label">): string | null {
  return typeof mark.label === "object" && mark.label !== null ? mark.label.slot : null
}

/**
 * `faceMasking.marks`' limits: at most `maxMarks` marks (erased and slot
 * marks together, the most boxes one mask-erase job takes), each edge within
 * `edgePct` (inclusive), and at most `maxMarkedPeople` optional people with
 * slot marks (a trend with more cannot be published: each combination of
 * them left empty is its own mask, 2^k − 1 of them).
 */
export const CAST_SWAP_FACE_MASK_MARK_LIMITS = {
  maxMarks: 50,
  edgePct: [0, 100],
  maxMarkedPeople: 3,
} as const

/**
 * How a trend's clip is prepared before it is sent (`faceMasking.source`,
 * absent = `"faces"`):
 *
 * - `"faces"`: today's face mask — the faces are hidden.
 * - `"full-depth"`: the whole clip becomes one grayscale depth video.
 * - `"keep-people"`: the people (the mask's `target`, `"body"` by default)
 *   stay as filmed and everything else becomes depth; `"main"` marks keep
 *   only the main character.
 *
 * The two depth modes need `mode: "always"`.
 */
export const CAST_SWAP_SOURCE_MODES = ["faces", "full-depth", "keep-people"] as const
export type CastSwapSourceMode = (typeof CAST_SWAP_SOURCE_MODES)[number]
