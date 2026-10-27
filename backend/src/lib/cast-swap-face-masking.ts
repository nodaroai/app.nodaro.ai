/**
 * Cast Swap's `faceMasking` setting (camelCase, as the `/v1/cast-swap` body
 * takes it and `@nodaro/sdk`'s `CastSwapFaceMasking` types it): cover the
 * faces in the source clip before the video model sees it.
 *
 * One definition for every backend place that stores or validates it (a
 * trend version's `faceMasking`, for one). Keys left out take the engine's
 * defaults; strict objects, so a misspelt key is an error, never dropped.
 * `zone` left out is 10 % margins at the left and right
 * (`CAST_SWAP_FACE_MASKING_DEFAULTS.zone`); `zone: null`, or all four margins
 * 0, is no margins. Stored as given: a left-out zone stays left out, and the
 * default is filled in only when a run is composed (`withResolvedZone`).
 */
import { z } from "zod"
import {
  CAST_SWAP_FACE_MASKING_BOUNDS,
  CAST_SWAP_FACE_MASKING_DEFAULTS,
  CAST_SWAP_FACE_MASK_TARGETS,
  type CastSwapFaceMaskTarget,
} from "@nodaro/shared/models"
// Internal only (render-rules, not an Apache grant): a trend face mask's marks.
import {
  CAST_SWAP_FACE_MASK_MARK_LABELS,
  CAST_SWAP_FACE_MASK_MARK_LIMITS,
  faceMaskMarkSlot,
  isErasedFaceMaskMark,
  type FaceMaskMark,
  type MaskEraseBox,
} from "@nodaro/render-rules"
import { getPluginSupports } from "./private-plugins/supports-registry.js"

export type FaceMaskingMode = "off" | "always" | "auto"
export type FaceMaskingFill = "blur" | "depth"
/** What a mask covers: `"head"` (default: hair and people seen from behind too) or `"face"` (the hair stays visible). */
export type FaceMaskingTarget = CastSwapFaceMaskTarget
export type { FaceMaskMark, MaskEraseBox }

export interface FaceMaskingZone {
  leftPct?: number
  rightPct?: number
  topPct?: number
  bottomPct?: number
}

export interface FaceMasking {
  mode: FaceMaskingMode
  /**
   * What a mask covers. Left out = `"head"` (`CAST_SWAP_FACE_MASKING_DEFAULTS.target`):
   * the whole head, hair included, and people seen from behind or turned away;
   * `"face"` covers the face only and leaves the hair visible.
   */
  target?: FaceMaskingTarget
  fill?: FaceMaskingFill
  /** Mask only faces at least this % of the frame's height (0–100). */
  minFaceHeightPct?: number
  /** And at most this % (0–100); 0 = no limit. Above 0 it must be ≥ `minFaceHeightPct`. */
  maxFaceHeightPct?: number
  /**
   * Frame margins (0–49 % each, a margin left out of a given zone = 0); a face
   * centred in one is not masked. Left out = 10 % at the left and right; null
   * (or all 0) = no margins.
   */
  zone?: FaceMaskingZone | null
  /** The blur's strength, 0.1–5 % of the frame's width. */
  blurStrengthPct?: number
  /** How sure the face finder must be, 0.05–0.95. */
  threshold?: number
}

/**
 * A trend's face masking setting: `FaceMasking` plus `marks`, labelled boxes
 * on its stored face mask (`FaceMaskMark`, at most 50; decided 2026-10-26).
 * `"erased"`: the faces centred in the box, on its frames, are left out of
 * the mask. `{ slot }` (decided 2026-10-27): the faces are that optional
 * person's, left out only of the mask variants made for runs that leave the
 * person empty — never of the base mask, its settings key or its make
 * (`erasedMarksOf`). Marks belong to a trend's STORED face
 * mask only: `faceMaskingWithMarksSchema` is the one schema that takes them
 * (Nodaro Motion's defaults, through `faceMaskingSchema`, refuse the key), the
 * make route sends them to the engine, and a run never does (`withoutMarks`
 * gives the `FaceMasking` a run body carries, which has no such key).
 */
export interface FaceMaskingWithMarks extends FaceMasking {
  marks?: FaceMaskMark[]
}

/** The engine's default `minFaceHeightPct`, for the `min ≤ max` check when min is left out. */
export const FACE_MASKING_DEFAULT_MIN_FACE_HEIGHT_PCT = CAST_SWAP_FACE_MASKING_DEFAULTS.minFaceHeightPct

/** A number within `[min, max]` (the bounds in `@nodaro/shared`, which the admin screen reads too). */
const within = ([min, max]: readonly [number, number]) => z.number().min(min).max(max)
const pct = within(CAST_SWAP_FACE_MASKING_BOUNDS.faceHeightPct)
const margin = within(CAST_SWAP_FACE_MASKING_BOUNDS.zonePct)

export const faceMaskingZoneSchema: z.ZodType<FaceMaskingZone> = z.strictObject({
  leftPct: margin.optional(),
  rightPct: margin.optional(),
  topPct: margin.optional(),
  bottomPct: margin.optional(),
})

const edge = within(CAST_SWAP_FACE_MASK_MARK_LIMITS.edgePct)
const frame = z.int().min(0)
const boxShape = { fromFrame: frame, toFrame: frame, leftPct: edge, topPct: edge, rightPct: edge, bottomPct: edge }
type Box = Pick<MaskEraseBox, "fromFrame" | "toFrame" | "leftPct" | "rightPct" | "topPct" | "bottomPct">
/** Whole frames, `from ≤ to`, and a box with room inside (`left < right`, `top < bottom`). */
function boxChecks<T extends z.ZodType<Box>>(schema: T) {
  return schema
    .refine((b) => b.fromFrame <= b.toFrame, { path: ["toFrame"], message: "The last frame must be at or after the first." })
    .refine((b) => b.leftPct < b.rightPct, { path: ["rightPct"], message: "The box's right edge must be right of its left edge." })
    .refine((b) => b.topPct < b.bottomPct, { path: ["bottomPct"], message: "The box's bottom edge must be below its top edge." })
}

/** One box of the core `mask-erase` job (`MaskEraseBox`), strict. */
export const maskEraseBoxSchema: z.ZodType<MaskEraseBox> = boxChecks(z.strictObject(boxShape))

/**
 * A slot mark's label, `{ slot }`: a trend slot's key (whether it names an
 * optional person slot of the same trend is the trend schema's check).
 */
const slotLabelSchema = z.strictObject({ slot: z.string().min(1).max(32) })

/** One face mask mark (`FaceMaskMark`): a label (`"erased"` or `{ slot }`) and a box (`maskEraseBoxSchema`'s checks), strict. */
export const faceMaskMarkSchema: z.ZodType<FaceMaskMark> = boxChecks(
  z.strictObject({ label: z.union([z.enum(CAST_SWAP_FACE_MASK_MARK_LABELS), slotLabelSchema]), ...boxShape }),
)

const faceMaskingShape = {
  mode: z.enum(["off", "always", "auto"]),
  target: z.enum(CAST_SWAP_FACE_MASK_TARGETS).optional(),
  fill: z.enum(["blur", "depth"]).optional(),
  minFaceHeightPct: pct.optional(),
  maxFaceHeightPct: pct.optional(),
  zone: faceMaskingZoneSchema.nullable().optional(),
  blurStrengthPct: within(CAST_SWAP_FACE_MASKING_BOUNDS.blurStrengthPct).optional(),
  threshold: within(CAST_SWAP_FACE_MASKING_BOUNDS.threshold).optional(),
}

const faceHeightsInOrder = (m: Pick<FaceMasking, "minFaceHeightPct" | "maxFaceHeightPct">) =>
  m.maxFaceHeightPct === undefined ||
  m.maxFaceHeightPct === 0 ||
  m.maxFaceHeightPct >= (m.minFaceHeightPct ?? FACE_MASKING_DEFAULT_MIN_FACE_HEIGHT_PCT)
const faceHeightsMessage = { path: ["maxFaceHeightPct"], message: "The largest face height must be at least the smallest (or 0 for no limit)." }

/** A face masking setting without marks: what a run takes, and Nodaro Motion's defaults. */
export const faceMaskingSchema: z.ZodType<FaceMasking> = z
  .strictObject(faceMaskingShape)
  .refine(faceHeightsInOrder, faceHeightsMessage)

/** A trend's face masking setting: `faceMaskingSchema` plus `marks` (at most `CAST_SWAP_FACE_MASK_MARK_LIMITS.maxMarks`). */
export const faceMaskingWithMarksSchema: z.ZodType<FaceMaskingWithMarks> = z
  .strictObject({ ...faceMaskingShape, marks: z.array(faceMaskMarkSchema).max(CAST_SWAP_FACE_MASK_MARK_LIMITS.maxMarks).optional() })
  .refine(faceHeightsInOrder, faceHeightsMessage)

/** The setting's marks; none (absent or empty) = `[]`. */
export function faceMaskMarksOf(m: Pick<FaceMaskingWithMarks, "marks"> | undefined): readonly FaceMaskMark[] {
  return m?.marks ?? []
}

/**
 * The setting's `"erased"` marks: the only marks the base mask, its settings
 * key, its make and its approval look at (slot marks shape the per-person
 * variants only).
 */
export function erasedMarksOf(m: Pick<FaceMaskingWithMarks, "marks"> | undefined): FaceMaskMark[] {
  return faceMaskMarksOf(m).filter(isErasedFaceMaskMark)
}

/** The setting's slot marks (`{ slot }`), each with the slot it names. */
export function slotMarksOf(m: Pick<FaceMaskingWithMarks, "marks"> | undefined): Array<{ slot: string; mark: FaceMaskMark }> {
  return faceMaskMarksOf(m).flatMap((mark) => {
    const slot = faceMaskMarkSlot(mark)
    return slot === null ? [] : [{ slot, mark }]
  })
}

/** A mark's box, its label dropped (a new object): what the core `mask-erase` job takes. */
export function boxOf(mark: MaskEraseBox): MaskEraseBox {
  const { fromFrame, toFrame, leftPct, topPct, rightPct, bottomPct } = mark
  return { fromFrame, toFrame, leftPct, topPct, rightPct, bottomPct }
}

/** The boxes of the setting's `"erased"` marks (labels dropped): what the core `mask-erase` job takes. */
export function erasedBoxesOf(m: Pick<FaceMaskingWithMarks, "marks"> | undefined): MaskEraseBox[] {
  return erasedMarksOf(m).map(boxOf)
}

/** The setting without its marks (a new object): what a run, and the base of a mask, are made from. */
export function withoutMarks(m: FaceMaskingWithMarks): FaceMasking {
  const { marks: _marks, ...rest } = m
  return rest
}

/** Whether this setting masks anything at all (absent or "off" = today's pipeline). */
export function faceMaskingOn(m: FaceMasking | undefined): m is FaceMasking {
  return !!m && m.mode !== "off"
}

/** What this setting's mask covers, its default resolved (left out = the whole head). */
export function faceMaskTargetOf(m: Pick<FaceMasking, "target">): FaceMaskingTarget {
  return m.target ?? CAST_SWAP_FACE_MASKING_DEFAULTS.target
}

/**
 * What a (loaded or recorded) Cast Swap engine's masks can cover. One that
 * predates the choice (`castSwap.faceMaskTargets` absent) masks heads alone,
 * as every 0.392.0 engine does, and drops a `target` it does not know (its
 * schema strips unknown keys), so a setting naming another target must be
 * held back rather than sent, or it would silently mask heads.
 */
export function faceMaskTargetsOf(
  cs: { readonly faceMaskTargets?: readonly FaceMaskingTarget[] } | undefined,
): readonly FaceMaskingTarget[] {
  return cs?.faceMaskTargets ?? [CAST_SWAP_FACE_MASKING_DEFAULTS.target]
}

/** Whether this process's Cast Swap engine masks `target` (`faceMaskTargetsOf` its declaration). */
export function loadedEngineMasksTarget(target: FaceMaskingTarget): boolean {
  return faceMaskTargetsOf(getPluginSupports().castSwap).includes(target)
}

/** The margins a face masking setting that leaves `zone` out gets (10 % at the left and right). */
export function defaultFaceMaskingZone(): Required<FaceMaskingZone> {
  return { ...CAST_SWAP_FACE_MASKING_DEFAULTS.zone }
}

/**
 * The setting with its zone resolved, as a run sends it: a zone left out
 * becomes the default margins; `null` becomes all four margins 0 (no margins,
 * spelt so an engine that predates `null` reads it the same); any zone given
 * stays as it is. So "no margins" is never read as "the default". A new
 * object; the input is not changed.
 */
export function withResolvedZone(m: FaceMasking): FaceMasking {
  if (m.zone === undefined) return { ...m, zone: defaultFaceMaskingZone() }
  if (m.zone === null) return { ...m, zone: { leftPct: 0, rightPct: 0, topPct: 0, bottomPct: 0 } }
  return { ...m, zone: { ...m.zone } }
}
