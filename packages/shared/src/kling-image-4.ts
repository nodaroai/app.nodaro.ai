/**
 * Kling Image 4.0: a text-to-image id and its edit sibling, both served by one
 * KIE endpoint. The person picks "Kling Image 4.0"; a run with input images
 * runs on the edit id (`T2I_TO_I2I_VARIANT`), which is priced per input item.
 *
 * It renders 2K, 4K or 8K natively (no 1K), takes up to 10 input items in all
 * (reference images plus named subjects), and can return a coherent SET of 2
 * to 10 images from one task.
 *
 * Only the ids and levers live in this published package. The rates and the
 * formula are `backend/src/ee/billing/kling-image-4-pricing.ts`.
 *
 * Not the Kling 4.0 VIDEO models (`kling-4`, `kling-4-keyframes`,
 * `kling-4-flash`): nothing here may match an id by prefix.
 */

export const KLING_IMAGE_4_T2I = "kling-image-4"
export const KLING_IMAGE_4_I2I = "kling-image-4-i2i"
export type KlingImage4Model = typeof KLING_IMAGE_4_T2I | typeof KLING_IMAGE_4_I2I

/** The sizes it renders, smallest first. It has no 1K. */
export const KLING_IMAGE_4_RESOLUTIONS = ["2K", "4K", "8K"] as const
export type KlingImage4Resolution = (typeof KLING_IMAGE_4_RESOLUTIONS)[number]

/** The size a run renders when it names none, and the size an unknown value is priced and sent at. */
export const KLING_IMAGE_4_DEFAULT_RESOLUTION: KlingImage4Resolution = "2K"

/**
 * The eight ratios plus "auto" (the provider's own default, which follows the
 * prompt and the reference images). "auto" is listed LAST, as on MiniMax H3
 * Image, so a fallback that takes the first ratio lands on a real one.
 */
export const KLING_IMAGE_4_ASPECT_RATIOS = ["1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3", "21:9", "auto"] as const

/**
 * The most input items one run takes and is priced for: reference images and
 * named subjects together (each subject counts once, whatever its views).
 */
export const KLING_IMAGE_4_MAX_INPUT_ITEMS = 10

/**
 * The most PICTURES one run may carry: 10 input items, each a named subject of
 * up to 4 views (decided 2026-11-23: the limit counts items, as the provider
 * does). The routes' picture lists are bounded at this for this model only;
 * what is refused is more than {@link KLING_IMAGE_4_MAX_INPUT_ITEMS} items.
 */
export const KLING_IMAGE_4_MAX_PICTURES = 40

/** The fewest and the most images a set (the provider's series mode) returns. */
export const KLING_IMAGE_4_SET_MIN = 2
export const KLING_IMAGE_4_SET_MAX = 10

/** A named subject takes 2 to 4 views of one subject; its description at most 100 characters. */
export const KLING_IMAGE_4_SUBJECT_MIN_VIEWS = 2
export const KLING_IMAGE_4_SUBJECT_MAX_VIEWS = 4
export const KLING_IMAGE_4_SUBJECT_DESCRIPTION_MAX = 100

/** The longest prompt the provider takes. */
export const KLING_IMAGE_4_MAX_PROMPT_CHARS = 20_000

export function isKlingImage4(model: unknown): model is KlingImage4Model {
  return model === KLING_IMAGE_4_T2I || model === KLING_IMAGE_4_I2I
}

export function isKlingImage4I2i(model: unknown): model is typeof KLING_IMAGE_4_I2I {
  return model === KLING_IMAGE_4_I2I
}

/** The size a run is priced and sent at: the one asked for in any case, else the default. */
export function klingImage4Resolution(resolution: unknown): KlingImage4Resolution {
  const asked = typeof resolution === "string" ? resolution.trim().toUpperCase() : ""
  return KLING_IMAGE_4_RESOLUTIONS.find((r) => r === asked) ?? KLING_IMAGE_4_DEFAULT_RESOLUTION
}

/**
 * The number of images a set asks for, 2 to 10, or `undefined` for a run that
 * is not a set (no value, 0, 1, or not a number). A value above 10 is 10.
 * Every place that prices, sends or settles a set reads it through here.
 */
export function klingImage4SetCount(value: unknown): number | undefined {
  const n = typeof value === "number" ? value : typeof value === "string" && value.trim() !== "" ? Number(value) : Number.NaN
  if (!Number.isFinite(n)) return undefined
  const whole = Math.trunc(n)
  if (whole < KLING_IMAGE_4_SET_MIN) return undefined
  return Math.min(whole, KLING_IMAGE_4_SET_MAX)
}

/**
 * The price id of a Kling Image 4.0 run:
 *   - `kling-image-4:<size>` from a prompt, one image;
 *   - `kling-image-4-i2i:<size>:<N>ref` with N input items (1 to 10);
 *   - either with `:x<C>` for a set of C images (2 to 10).
 * A text-to-image id sent input items is priced on the edit id, the id the
 * provider runs. An edit always has at least one item. A size off the grid is
 * priced at the default, 2K. The bare ids are never built here.
 */
export function klingImage4CreditId(
  provider: KlingImage4Model,
  resolution: unknown,
  inputItems: number | undefined,
  setCount?: unknown,
): string {
  const size = klingImage4Resolution(resolution)
  const asked = Number.isFinite(inputItems) ? Math.trunc(inputItems as number) : 0
  const edit = provider === KLING_IMAGE_4_I2I || asked > 0
  const set = klingImage4SetCount(setCount)
  const suffix = set !== undefined ? `:x${set}` : ""
  if (!edit) return `${KLING_IMAGE_4_T2I}:${size}${suffix}`
  const items = Math.min(Math.max(1, asked), KLING_IMAGE_4_MAX_INPUT_ITEMS)
  return `${KLING_IMAGE_4_I2I}:${size}:${items}ref${suffix}`
}
