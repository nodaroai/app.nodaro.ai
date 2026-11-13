/**
 * FLUX 3 Klein: a text-to-image id and its edit sibling, priced by size alone
 * (1K, 2K or 4K). An edit's reference images cost nothing extra, so the edit
 * id has the same rows as the text-to-image id.
 *
 * Only the ids and levers live in this published package. The rates are
 * `backend/src/ee/billing/flux-3-klein-pricing.ts`.
 *
 * A different model from FLUX 2 Klein (`flux-2-klein`, which runs elsewhere):
 * neither id may join a set keyed on the FLUX 2 family (`isFlux2Model`).
 */

export const FLUX_3_KLEIN_T2I = "flux-3-klein"
export const FLUX_3_KLEIN_I2I = "flux-3-klein-i2i"
export type Flux3KleinModel = typeof FLUX_3_KLEIN_T2I | typeof FLUX_3_KLEIN_I2I

/** The sizes it renders, smallest first. */
export const FLUX_3_KLEIN_RESOLUTIONS = ["1K", "2K", "4K"] as const
export type Flux3KleinResolution = (typeof FLUX_3_KLEIN_RESOLUTIONS)[number]

/**
 * The size a run renders when it names none: the provider's own default, and
 * the size an unset or unknown value is priced and sent at.
 */
export const FLUX_3_KLEIN_DEFAULT_RESOLUTION: Flux3KleinResolution = "1K"

/** The most reference images one edit takes (`REF_IMAGE_MAX_LIMITS`). */
export const FLUX_3_KLEIN_MAX_INPUT_IMAGES = 10

export function isFlux3Klein(model: unknown): model is Flux3KleinModel {
  return model === FLUX_3_KLEIN_T2I || model === FLUX_3_KLEIN_I2I
}

export function isFlux3KleinI2i(model: unknown): model is typeof FLUX_3_KLEIN_I2I {
  return model === FLUX_3_KLEIN_I2I
}

/**
 * The size a FLUX 3 Klein run is priced and sent at: the one asked for when it
 * is one of its sizes (any case), else the default. Unset is the default.
 */
export function flux3KleinResolution(resolution: unknown): Flux3KleinResolution {
  const asked = typeof resolution === "string" ? resolution.trim().toUpperCase() : ""
  return FLUX_3_KLEIN_RESOLUTIONS.find((r) => r === asked) ?? FLUX_3_KLEIN_DEFAULT_RESOLUTION
}

/**
 * The price id of a FLUX 3 Klein run: `flux-3-klein:<size>`, or
 * `flux-3-klein-i2i:<size>` for an edit. The bare ids are never built here.
 *
 * A size off its list (a stored node, the multi-model preview pricing one
 * node's data against every model) or none is priced at the default, 1K, which
 * is what the provider renders with none. A text-to-image id sent any image
 * runs on the edit endpoint (the KIE provider swaps it), so it is priced on the
 * edit id whenever `referenceImageCount` is above 0. Every caller passes the
 * images the run sends (`priceReadsInputImages` in `input-image-pricing.ts`: a
 * base image, references, wired images, an entity's source), so the id priced
 * is the id run. Both ids cost the same at each size.
 */
export function flux3KleinCreditId(
  provider: Flux3KleinModel,
  resolution: unknown,
  referenceImageCount: number | undefined,
): string {
  const size = flux3KleinResolution(resolution)
  const images = Number.isFinite(referenceImageCount) ? Math.trunc(referenceImageCount as number) : 0
  const model = provider === FLUX_3_KLEIN_I2I || images > 0 ? FLUX_3_KLEIN_I2I : FLUX_3_KLEIN_T2I
  return `${model}:${size}`
}
