/**
 * Cast Swap's `faceMasking` setting (camelCase, as the `/v1/cast-swap` body
 * takes it and `@nodaro/sdk`'s `CastSwapFaceMasking` types it): cover the
 * faces in the source clip before the video model sees it.
 *
 * One definition for every backend place that stores or validates it (a
 * trend version's `faceMasking`, for one). Keys left out take the engine's
 * defaults; strict objects, so a misspelt key is an error, never dropped.
 */
import { z } from "zod"
import { CAST_SWAP_FACE_MASKING_BOUNDS, CAST_SWAP_FACE_MASKING_DEFAULTS } from "@nodaro/shared/models"

export type FaceMaskingMode = "off" | "always" | "auto"
export type FaceMaskingFill = "blur" | "depth"

export interface FaceMaskingZone {
  leftPct?: number
  rightPct?: number
  topPct?: number
  bottomPct?: number
}

export interface FaceMasking {
  mode: FaceMaskingMode
  fill?: FaceMaskingFill
  /** Mask only faces at least this % of the frame's height (0–100). */
  minFaceHeightPct?: number
  /** And at most this % (0–100); 0 = no limit. Above 0 it must be ≥ `minFaceHeightPct`. */
  maxFaceHeightPct?: number
  /** Frame margins (0–49 % each); a face centred in one is not masked. */
  zone?: FaceMaskingZone
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
    fill: z.enum(["blur", "depth"]).optional(),
    minFaceHeightPct: pct.optional(),
    maxFaceHeightPct: pct.optional(),
    zone: faceMaskingZoneSchema.optional(),
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
