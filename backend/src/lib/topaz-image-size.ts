/**
 * Topaz image upscale, priced by output size (decided 2026-10-25,
 * `@nodaro/render-rules` topaz-pricing.ts): a run is charged its factor's tier
 * row or the one-unit row × the output's size units, whichever is higher — an
 * ordinary image costs what it always did, a very large one is not sold below
 * what the provider bills for it.
 *
 * One reading for both lanes that charge such a run: `/v1/edit-image`'s guard
 * and the workflow run's reservation (`node-executor.ts`). The size is read
 * from the image's header; an image whose size cannot be read is charged its
 * tier row (the worker reads it in full and fails an unreadable one, refunded).
 */
import {
  TOPAZ_IMAGE_MAX_OUTPUT_MP,
  TOPAZ_IMAGE_UNIT_CREDIT_ID,
  topazImageOutputMegapixels,
  topazImageSizeUnits,
} from "@nodaro/render-rules"
import { resolveTopazUpscale } from "@nodaro/shared/credits"
import { buildCreditModelIdentifier } from "@nodaro/shared/credits"
import { probeImageDisplaySize } from "./image-source-size.js"
import { baseCreditCostFor, unitRateBaseCredits } from "./credit-base-cost.js"

export type TopazImageSizeReading =
  | { readonly kind: "sized"; readonly units: number; readonly megapixels: number }
  | { readonly kind: "too-large"; readonly megapixels: number }
  | { readonly kind: "unknown" }

/** The output size an upscale of the image at `imageUrl` by `factor` produces, in the provider's units. */
export async function readTopazImageSize(imageUrl: string, factor: string): Promise<TopazImageSizeReading> {
  const size = await probeImageDisplaySize(imageUrl)
  if (!size) return { kind: "unknown" }
  const megapixels = topazImageOutputMegapixels(size.width, size.height, Number(factor) || 2)
  const units = topazImageSizeUnits(megapixels)
  return units === undefined ? { kind: "too-large", megapixels } : { kind: "sized", units, megapixels }
}

/** The refusal of an output past the provider's largest size — before anything is reserved. */
export function topazImageTooLargeMessage(megapixels: number): string {
  return `This upscale would produce a ${Math.round(megapixels)}-megapixel image; Topaz upscales up to ${TOPAZ_IMAGE_MAX_OUTPUT_MP} megapixels. Choose a smaller factor or a smaller image.`
}

/**
 * The BASE (pre-markup) credits an upscale of `sizeUnits` units costs when that
 * is above its tier row, else undefined (the tier row prices it, as before).
 */
export async function topazImageSizeBaseCredits(tierCreditId: string, sizeUnits: number): Promise<number | undefined> {
  const [tier, bySize] = await Promise.all([
    baseCreditCostFor(tierCreditId),
    unitRateBaseCredits(TOPAZ_IMAGE_UNIT_CREDIT_ID, sizeUnits),
  ])
  return bySize > tier ? bySize : undefined
}

/** The tier credit id and the factor a Topaz request renders at (the route's and the payload builder's reading). */
export function topazImageTier(input: { upscaleFactor?: unknown; targetResolution?: unknown }): { creditId: string; factor: string } {
  const resolved = resolveTopazUpscale({
    upscaleFactor: typeof input.upscaleFactor === "string" ? input.upscaleFactor : undefined,
    targetResolution: typeof input.targetResolution === "string" ? input.targetResolution : undefined,
  })
  return {
    creditId: buildCreditModelIdentifier("topaz-image-upscale", undefined, undefined, undefined, resolved.creditTier),
    factor: resolved.upscaleFactor,
  }
}

/** Is this queued job a Topaz image upscale? */
export function isTopazImageUpscaleJob(jobName: string, payload: Record<string, unknown>): boolean {
  return jobName === "edit-image" && payload.provider === "topaz-image-upscale"
}

/**
 * The workflow run's twin of the route's guard: read the image the payload
 * sends and stamp its size units (`topazSizeUnits`), or refuse an output past
 * the largest size before a jobs row is kept. Only where credits are charged.
 */
export async function stampTopazImageSize(
  jobName: string,
  payload: Record<string, unknown>,
  creditsOn: boolean,
): Promise<{ ok: true; patch: Record<string, unknown> } | { ok: false; message: string }> {
  if (!creditsOn || !isTopazImageUpscaleJob(jobName, payload)) return { ok: true, patch: {} }
  const imageUrl = typeof payload.imageUrl === "string" ? payload.imageUrl : undefined
  if (!imageUrl) return { ok: true, patch: {} }
  const reading = await readTopazImageSize(imageUrl, topazImageTier(payload).factor)
  if (reading.kind === "too-large") return { ok: false, message: topazImageTooLargeMessage(reading.megapixels) }
  return { ok: true, patch: reading.kind === "sized" ? { topazSizeUnits: reading.units } : {} }
}

/** The BASE credits a stamped Topaz image payload costs above its tier row, or undefined. */
export async function topazImageStampedBaseCredits(
  jobName: string,
  payload: Record<string, unknown>,
): Promise<number | undefined> {
  if (!isTopazImageUpscaleJob(jobName, payload)) return undefined
  const units = payload.topazSizeUnits
  if (typeof units !== "number" || !Number.isFinite(units) || units <= 0) return undefined
  return topazImageSizeBaseCredits(topazImageTier(payload).creditId, units)
}
