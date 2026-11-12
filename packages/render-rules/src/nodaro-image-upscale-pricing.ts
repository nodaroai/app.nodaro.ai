/**
 * How a Nodaro Image Upscale run is sized and priced (decided 2026-11-11).
 *
 * The output is exactly the input × the factor on each side, nothing cropped,
 * and a run is priced by the OUTPUT's total pixels, in three tiers — one
 * `model_pricing` row each, so an administrator's retune moves the hold, the
 * quote and the charge together. A 1x run enhances at the same size, so it is
 * priced by the input's own size.
 *
 * An output past {@link NODARO_IMAGE_UPSCALE_MAX_OUTPUT_PIXELS} pixels or
 * {@link NODARO_IMAGE_UPSCALE_MAX_OUTPUT_SIDE} px on a side is refused before
 * anything is reserved. An image whose size cannot be read before the run is
 * held at the bare id ({@link NODARO_IMAGE_UPSCALE_HOLD_CREDIT_ID}, the top tier's
 * price) and settled to the delivered output's tier.
 *
 * One function sizes every surface: the route's guard, the workflow run's
 * reservation, the server's estimate and the editor's badge. Integer pixel
 * math throughout — no megapixel rounding at a boundary.
 */
import { resolveNodaroImageUpscaleFactor } from "@nodaro/shared/credits"

/** The id a run holds when its image's size is unknown — priced as the top tier. */
export const NODARO_IMAGE_UPSCALE_HOLD_CREDIT_ID = "nodaro-image-upscale"

/** The largest output, in total pixels (8192 × 8192). */
export const NODARO_IMAGE_UPSCALE_MAX_OUTPUT_PIXELS = 67_108_864

/** The longest side an output may have, in pixels. */
export const NODARO_IMAGE_UPSCALE_MAX_OUTPUT_SIDE = 16_384

/** The price tiers, smallest first: an output of up to `maxPixels` total pixels is charged `creditId`. */
export const NODARO_IMAGE_UPSCALE_TIERS: ReadonlyArray<{ readonly creditId: string; readonly maxPixels: number }> = Object.freeze([
  { creditId: "nodaro-image-upscale:2K", maxPixels: 4_194_304 },
  { creditId: "nodaro-image-upscale:4K", maxPixels: 16_777_216 },
  { creditId: "nodaro-image-upscale:8K", maxPixels: NODARO_IMAGE_UPSCALE_MAX_OUTPUT_PIXELS },
])

/** Every id a Nodaro Image Upscale run can be charged: the tiers, then the hold. */
export const NODARO_IMAGE_UPSCALE_CREDIT_IDS: readonly string[] = Object.freeze([
  ...NODARO_IMAGE_UPSCALE_TIERS.map((t) => t.creditId),
  NODARO_IMAGE_UPSCALE_HOLD_CREDIT_ID,
])

export interface NodaroImageUpscaleImageSize {
  readonly width: number
  readonly height: number
}

export type NodaroImageUpscaleSizing =
  | {
      readonly kind: "sized"
      readonly width: number
      readonly height: number
      readonly pixels: number
      readonly creditId: string
    }
  | {
      readonly kind: "too-large"
      readonly width: number
      readonly height: number
      readonly pixels: number
    }

/** The tier id an output of `pixels` total pixels is charged, or undefined past the largest output. */
export function nodaroImageUpscaleTierCreditId(pixels: number): string | undefined {
  if (!Number.isFinite(pixels) || pixels <= 0) return undefined
  return NODARO_IMAGE_UPSCALE_TIERS.find((t) => pixels <= t.maxPixels)?.creditId
}

/** A side of at least one whole pixel, or undefined. */
function side(v: unknown): number | undefined {
  if (typeof v !== "number" || !Number.isFinite(v)) return undefined
  const n = Math.round(v)
  return n >= 1 ? n : undefined
}

/**
 * The output an upscale of an image of `size` by `factor` produces, and the id
 * it is charged — or `too-large` when it passes either limit. `factor` is read
 * as the run reads it (an invalid one is the default, 2). Undefined when the
 * size is not a real one.
 */
export function nodaroImageUpscaleSizing(size: Partial<NodaroImageUpscaleImageSize> | undefined, factor: unknown): NodaroImageUpscaleSizing | undefined {
  const w = side(size?.width)
  const h = side(size?.height)
  if (w === undefined || h === undefined) return undefined
  const f = Number(resolveNodaroImageUpscaleFactor(factor))
  const width = w * f
  const height = h * f
  const pixels = width * height
  const creditId = Math.max(width, height) <= NODARO_IMAGE_UPSCALE_MAX_OUTPUT_SIDE ? nodaroImageUpscaleTierCreditId(pixels) : undefined
  return creditId === undefined ? { kind: "too-large", width, height, pixels } : { kind: "sized", width, height, pixels, creditId }
}

/**
 * The id an ESTIMATE or a reservation prices a run at: the output's tier when
 * the image's size is known and within the limits, else the hold (an unknown
 * size, or an output the run itself will refuse).
 */
export function nodaroImageUpscaleCreditId(size: Partial<NodaroImageUpscaleImageSize> | undefined, factor: unknown): string {
  const sizing = nodaroImageUpscaleSizing(size, factor)
  return sizing?.kind === "sized" ? sizing.creditId : NODARO_IMAGE_UPSCALE_HOLD_CREDIT_ID
}

/** The refusal of an output past either limit — named in pixels, with what to change. */
export function nodaroImageUpscaleTooLargeMessage(sizing: { readonly width: number; readonly height: number }): string {
  const fmt = (n: number) => n.toLocaleString("en-US")
  return (
    `This upscale would produce a ${fmt(sizing.width)} × ${fmt(sizing.height)} image. ` +
    `Nodaro Image Upscale makes images of up to ${fmt(NODARO_IMAGE_UPSCALE_MAX_OUTPUT_PIXELS)} pixels in total ` +
    `and ${fmt(NODARO_IMAGE_UPSCALE_MAX_OUTPUT_SIDE)} pixels on a side. Choose a smaller factor or a smaller image.`
  )
}
