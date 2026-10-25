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
import { getPluginSupports } from "./private-plugins/supports-registry.js"

export type FaceMaskingMode = "off" | "always" | "auto"
export type FaceMaskingFill = "blur" | "depth"
/** What a mask covers: `"head"` (default: hair and people seen from behind too) or `"face"` (the hair stays visible). */
export type FaceMaskingTarget = CastSwapFaceMaskTarget

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

export const faceMaskingSchema: z.ZodType<FaceMasking> = z
  .strictObject({
    mode: z.enum(["off", "always", "auto"]),
    target: z.enum(CAST_SWAP_FACE_MASK_TARGETS).optional(),
    fill: z.enum(["blur", "depth"]).optional(),
    minFaceHeightPct: pct.optional(),
    maxFaceHeightPct: pct.optional(),
    zone: faceMaskingZoneSchema.nullable().optional(),
    blurStrengthPct: within(CAST_SWAP_FACE_MASKING_BOUNDS.blurStrengthPct).optional(),
    threshold: within(CAST_SWAP_FACE_MASKING_BOUNDS.threshold).optional(),
  })
  .refine(
    (m) =>
      m.maxFaceHeightPct === undefined ||
      m.maxFaceHeightPct === 0 ||
      m.maxFaceHeightPct >= (m.minFaceHeightPct ?? FACE_MASKING_DEFAULT_MIN_FACE_HEIGHT_PCT),
    { path: ["maxFaceHeightPct"], message: "The largest face height must be at least the smallest (or 0 for no limit)." },
  )

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
