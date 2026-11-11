/**
 * What makes Seedream 5.5 price differently from the other Seedream models: its
 * size (1K, 1.5K or 2K), and on an edit the number of input images as well.
 *
 * Only the ids and levers live in this published package. The rates and the
 * formula are `backend/src/ee/billing/seedream-5-5-pricing.ts`.
 */

export const SEEDREAM_5_5_T2I = "seedream-5-5"
export const SEEDREAM_5_5_I2I = "seedream-5-5-i2i"
export type Seedream55Model = typeof SEEDREAM_5_5_T2I | typeof SEEDREAM_5_5_I2I

/** The sizes it renders, smallest first; the provider names the field `size`. */
export const SEEDREAM_5_5_RESOLUTIONS = ["1K", "1.5K", "2K"] as const
export type Seedream55Resolution = (typeof SEEDREAM_5_5_RESOLUTIONS)[number]

/**
 * The size a run renders when it names none: the provider's own default, and
 * the size an unset or unknown value is priced and sent at. Every place that
 * fills an unset size for this model reads it from here.
 */
export const SEEDREAM_5_5_DEFAULT_RESOLUTION: Seedream55Resolution = "2K"

/** The most input images an edit takes, and is priced for (`REF_IMAGE_MAX_LIMITS`). */
export const SEEDREAM_5_5_MAX_INPUT_IMAGES = 10

/** The fewest characters a prompt may have: the provider refuses a shorter one. */
export const SEEDREAM_5_5_MIN_PROMPT_CHARS = 5

export function isSeedream55I2i(model: unknown): boolean {
  return model === SEEDREAM_5_5_I2I
}

export function isSeedream55(model: unknown): model is Seedream55Model {
  return model === SEEDREAM_5_5_T2I || model === SEEDREAM_5_5_I2I
}

/**
 * The size a Seedream 5.5 run is priced and sent at: the one asked for when it
 * is one of its sizes (any case), else the default. Unset is the default.
 */
export function seedream55Resolution(resolution: unknown): Seedream55Resolution {
  const asked = typeof resolution === "string" ? resolution.trim().toUpperCase() : ""
  return SEEDREAM_5_5_RESOLUTIONS.find((r) => r === asked) ?? SEEDREAM_5_5_DEFAULT_RESOLUTION
}
