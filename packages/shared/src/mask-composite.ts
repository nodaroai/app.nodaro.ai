/**
 * Mask Composite — place a foreground video over a background video through a
 * mask video (white = keep the foreground, black = show the background). The
 * wire contract of the `mask-composite` node, `POST /v1/mask-composite`, the
 * `mask_composite` MCP verb, `client.media.maskComposite` and
 * `nodaro media mask-composite`, defined ONCE. Pair it with Video Mask, whose
 * output is exactly such a mask.
 *
 * The render follows the FOREGROUND: its size, frame rate and length. The
 * background is fitted to that frame (`backgroundFit`) and loops when shorter;
 * the mask is stretched to the frame and holds its last frame when shorter.
 *
 * Priced per started 5 seconds of the result (the foreground's length), like
 * Trim / Loop / Combine Videos: the node's own `model_pricing` row is ONE unit
 * (`maskCompositeUnits` counts them). Worked examples (repeated in
 * docs/nodes/processing-video/mask-composite.md, at the 10-credit row):
 *   3 s → 1 unit (10),  10 s → 2 units (20),  61 s → 13 units (130),  5 min → 60 units (600).
 *
 * Wire contract only — no I/O.
 */

/** How the background is fitted to the foreground's frame. */
export const MASK_COMPOSITE_BACKGROUND_FITS = ["cover", "contain", "stretch"] as const
export type MaskCompositeBackgroundFit = (typeof MASK_COMPOSITE_BACKGROUND_FITS)[number]

/** Which sound the result carries. `mix` blends both tracks at equal level. */
export const MASK_COMPOSITE_AUDIO_SOURCES = ["foreground", "background", "mix", "none"] as const
export type MaskCompositeAudioSource = (typeof MASK_COMPOSITE_AUDIO_SOURCES)[number]

export const MASK_COMPOSITE_BOUNDS = {
  /** Edge softening, pixels of blur radius on the mask (0 = hard edge). */
  FEATHER_MIN: 0,
  FEATHER_MAX: 20,
  /** Grow (+) or shrink (−) the white region, pixels. */
  GROW_MIN: -10,
  GROW_MAX: 10,
  /** How strongly the foreground covers the background inside the mask
   *  (1 = fully, today's output; 0 = not at all). */
  OPACITY_MIN: 0,
  OPACITY_MAX: 1,
  /** The longest foreground a run accepts, seconds. */
  MAX_DURATION_SEC: 300,
} as const

/** Seconds of result one pricing unit covers. */
export const MASK_COMPOSITE_UNIT_SEC = 5

/**
 * Pricing units for a result `durationSec` long: one per started 5 seconds,
 * at least one. An unknown length counts the longest result a run accepts
 * (an upper bound — the pre-run quote for a clip whose length is not known
 * yet; every run measures its foreground).
 */
export function maskCompositeUnits(durationSec: number | null | undefined): number {
  const sec =
    typeof durationSec === "number" && Number.isFinite(durationSec) && durationSec > 0
      ? Math.min(durationSec, MASK_COMPOSITE_BOUNDS.MAX_DURATION_SEC)
      : MASK_COMPOSITE_BOUNDS.MAX_DURATION_SEC
  // The epsilon absorbs float noise (a 10.0000001 s probe is 2 units, not 3).
  return Math.max(1, Math.ceil(sec / MASK_COMPOSITE_UNIT_SEC - 1e-6))
}

export const MASK_COMPOSITE_DEFAULTS = {
  invertMask: false,
  feather: 2,
  grow: 0,
  opacity: 1,
  backgroundFit: "cover" as MaskCompositeBackgroundFit,
  audioSource: "foreground" as MaskCompositeAudioSource,
} as const

export interface MaskCompositeSettings {
  readonly invertMask: boolean
  readonly feather: number
  readonly grow: number
  /** Inside the mask: opacity × foreground + (1 − opacity) × background. */
  readonly opacity: number
  readonly backgroundFit: MaskCompositeBackgroundFit
  readonly audioSource: MaskCompositeAudioSource
}

const clampInt = (v: unknown, min: number, max: number, fallback: number): number =>
  typeof v === "number" && Number.isFinite(v) ? Math.min(max, Math.max(min, Math.round(v))) : fallback

const clampNumber = (v: unknown, min: number, max: number, fallback: number): number =>
  typeof v === "number" && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback

/**
 * Node data (or any loose object) → settings every engine renders with.
 * Unknown enum values fall back to the default and numbers are clamped, so a
 * node written straight into workflow JSON renders the same as one set in the
 * panel. The ONE normaliser both workflow engines and the worker call.
 */
export function resolveMaskCompositeSettings(data: Readonly<Record<string, unknown>>): MaskCompositeSettings {
  const d = MASK_COMPOSITE_DEFAULTS
  const b = MASK_COMPOSITE_BOUNDS
  return {
    invertMask: typeof data.invertMask === "boolean" ? data.invertMask : d.invertMask,
    feather: clampInt(data.feather, b.FEATHER_MIN, b.FEATHER_MAX, d.feather),
    grow: clampInt(data.grow, b.GROW_MIN, b.GROW_MAX, d.grow),
    opacity: clampNumber(data.opacity, b.OPACITY_MIN, b.OPACITY_MAX, d.opacity),
    backgroundFit: (MASK_COMPOSITE_BACKGROUND_FITS as readonly string[]).includes(data.backgroundFit as string)
      ? (data.backgroundFit as MaskCompositeBackgroundFit)
      : d.backgroundFit,
    audioSource: (MASK_COMPOSITE_AUDIO_SOURCES as readonly string[]).includes(data.audioSource as string)
      ? (data.audioSource as MaskCompositeAudioSource)
      : d.audioSource,
  }
}

/** `POST /v1/mask-composite` request body. */
export interface MaskCompositeRequest extends Partial<MaskCompositeSettings> {
  /** The video whose white-masked region is kept (its size, rate and length lead). */
  readonly foregroundUrl: string
  /** The video shown where the mask is black. */
  readonly backgroundUrl: string
  /** The mask video — white = foreground (Video Mask's output). */
  readonly maskUrl: string
}
