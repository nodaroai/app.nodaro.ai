/**
 * MiniMax H3 Image: a text-to-image id and its edit sibling. It is priced by
 * size (1K and 2K cost the same, 4K more) and, on an edit, by how many
 * reference images it is given.
 *
 * Only the ids and levers live in this published package. The rates and the
 * formula are `backend/src/ee/billing/minimax-h3-image-pricing.ts`.
 *
 * Not the MiniMax H3 VIDEO model, `minimax-h3`. These ids extend that string,
 * so nothing here may match by prefix, and neither id may join a set keyed on
 * the video model (`MINIMAX_H3_PROVIDERS`).
 */

export const MINIMAX_H3_IMAGE_T2I = "minimax-h3-image"
export const MINIMAX_H3_IMAGE_I2I = "minimax-h3-image-i2i"
export type MinimaxH3ImageModel = typeof MINIMAX_H3_IMAGE_T2I | typeof MINIMAX_H3_IMAGE_I2I

export const MINIMAX_H3_IMAGE_RESOLUTIONS = ["1K", "2K", "4K"] as const
export type MinimaxH3ImageResolution = (typeof MINIMAX_H3_IMAGE_RESOLUTIONS)[number]
/** What a run renders when it names no size: the provider's own default. */
export const MINIMAX_H3_IMAGE_DEFAULT_RESOLUTION: MinimaxH3ImageResolution = "2K"
/** The most reference images one edit takes (`REF_IMAGE_MAX_LIMITS`). */
export const MINIMAX_H3_IMAGE_MAX_INPUT_IMAGES = 16

export function isMinimaxH3Image(model: unknown): model is MinimaxH3ImageModel {
  return model === MINIMAX_H3_IMAGE_T2I || model === MINIMAX_H3_IMAGE_I2I
}

export function isMinimaxH3ImageI2i(model: unknown): model is typeof MINIMAX_H3_IMAGE_I2I {
  return model === MINIMAX_H3_IMAGE_I2I
}

/** The size a run is priced at: the one asked for in any case, else the default. */
function pricedResolution(resolution: unknown): MinimaxH3ImageResolution {
  const asked = typeof resolution === "string" ? resolution.trim().toLowerCase() : ""
  return MINIMAX_H3_IMAGE_RESOLUTIONS.find((r) => r.toLowerCase() === asked) ?? MINIMAX_H3_IMAGE_DEFAULT_RESOLUTION
}

/**
 * The price id of a MiniMax H3 Image run: `minimax-h3-image:<size>` from a
 * prompt, `minimax-h3-image-i2i:<size>:<N>ref` for an edit given N reference
 * images (1 to 16). The bare ids are never built here.
 *
 * A size off the grid (a stored node, the multi-model preview pricing one
 * node's data against every model) is priced at the default, 2K. The text-to-
 * image id sent reference images runs on the edit endpoint (the KIE provider
 * swaps it), so a caller that does not swap first (the entity routes, a
 * pipeline pin) is priced there too. An edit always has at least one image.
 */
export function minimaxH3ImageCreditId(
  provider: MinimaxH3ImageModel,
  resolution: unknown,
  referenceImageCount: number | undefined,
): string {
  const size = pricedResolution(resolution)
  const asked = Number.isFinite(referenceImageCount) ? Math.trunc(referenceImageCount as number) : 0
  const edit = provider === MINIMAX_H3_IMAGE_I2I || asked > 0
  if (!edit) return `${MINIMAX_H3_IMAGE_T2I}:${size}`
  const images = Math.min(Math.max(1, asked), MINIMAX_H3_IMAGE_MAX_INPUT_IMAGES)
  return `${MINIMAX_H3_IMAGE_I2I}:${size}:${images}ref`
}
