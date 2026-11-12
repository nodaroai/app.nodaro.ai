/**
 * The upscale FACTOR of the image upscalers that take one — which factors each
 * model accepts, and the factor a request renders at. One authority for the
 * route's enum, the editor's dropdown and its fail-safe snap, the workflow
 * payload, the worker, MCP and the SDK.
 *
 * Two models take a factor:
 *   - `topaz-image-upscale`: 1, 2 or 4 — resolved by `resolveTopazUpscale`,
 *     which also maps its legacy `targetResolution` (unchanged here).
 *   - `nodaro-image-upscale`: 1, 2, 4 or 8. A factor multiplies both sides; 1
 *     enhances the picture at its own size. Anything else is rendered at the
 *     default, 2. It has no `targetResolution`: its price follows the output's
 *     size (`@nodaro/render-rules` nodaro-image-upscale-pricing.ts), so a stored
 *     tier from another model is never read.
 *
 * Every other model (Recraft, and the edit models) declares no factor list,
 * and a factor stored or mapped onto its node is passed on exactly as it
 * always was — "1", "2" and "4" are the values the route takes for it — except
 * a factor only the house model takes ({@link HOUSE_ONLY_UPSCALE_FACTORS}, "8"):
 * no other model takes it, so it is never sent to one, and the editor clears
 * it from a node switched away from Nodaro Image Upscale.
 */
import { resolveTopazUpscale, TOPAZ_UPSCALE_FACTORS } from "./topaz-upscale.js"

/** Nodaro Image Upscale's model id. */
export const NODARO_IMAGE_UPSCALE_MODEL_ID = "nodaro-image-upscale"

export type NodaroImageUpscaleFactor = "1" | "2" | "4" | "8"

/** The factors Nodaro Image Upscale renders at, smallest first. */
export const NODARO_IMAGE_UPSCALE_FACTORS: readonly NodaroImageUpscaleFactor[] = ["1", "2", "4", "8"]

/** The factor a Nodaro Image Upscale request without a valid one renders at. */
export const NODARO_IMAGE_UPSCALE_DEFAULT_FACTOR: NodaroImageUpscaleFactor = "2"

/** Every factor any image upscaler takes — the vocabulary the request enums carry. Each model's own list is {@link upscaleFactorsFor}. */
export const UPSCALE_FACTORS = ["1", "2", "4", "8"] as const
export type UpscaleFactor = (typeof UPSCALE_FACTORS)[number]

/** The factor Nodaro Image Upscale renders `raw` at: a listed factor as given (trimmed), anything else the default. */
export function resolveNodaroImageUpscaleFactor(raw: unknown): NodaroImageUpscaleFactor {
  const trimmed = typeof raw === "string" ? raw.trim() : typeof raw === "number" ? String(raw) : ""
  return (NODARO_IMAGE_UPSCALE_FACTORS as readonly string[]).includes(trimmed)
    ? (trimmed as NodaroImageUpscaleFactor)
    : NODARO_IMAGE_UPSCALE_DEFAULT_FACTOR
}

/**
 * The factors only Nodaro Image Upscale takes: every other model's request
 * refuses them (Topaz's list, and the 1/2/4 the route takes for a model with
 * no list of its own), so none is ever sent to another model. "8".
 */
export const HOUSE_ONLY_UPSCALE_FACTORS: readonly UpscaleFactor[] = NODARO_IMAGE_UPSCALE_FACTORS.filter(
  (f) => !(TOPAZ_UPSCALE_FACTORS as readonly string[]).includes(f),
)

/** True when `value` is a factor only Nodaro Image Upscale takes ({@link HOUSE_ONLY_UPSCALE_FACTORS}). */
function isHouseOnlyUpscaleFactor(value: string): boolean {
  return (HOUSE_ONLY_UPSCALE_FACTORS as readonly string[]).includes(value.trim())
}

/** The factors `provider` accepts, or undefined for a model that declares no factor list. */
export function upscaleFactorsFor(provider: unknown): readonly UpscaleFactor[] | undefined {
  if (provider === NODARO_IMAGE_UPSCALE_MODEL_ID) return NODARO_IMAGE_UPSCALE_FACTORS
  if (provider === "topaz-image-upscale") return TOPAZ_UPSCALE_FACTORS
  return undefined
}

/**
 * The factor a request to `provider` sends: Topaz's through `resolveTopazUpscale`
 * (its legacy `targetResolution` included), Nodaro Image Upscale's through
 * {@link resolveNodaroImageUpscaleFactor}, and any other model's value as
 * given — except a factor only the house model takes ("8"), which is not
 * sent. What the editor's panel snaps a stale value to, and what the editor's
 * Run and the workflow payload send.
 */
export function resolveUpscaleFactor(
  provider: unknown,
  input: { upscaleFactor?: unknown; targetResolution?: unknown },
): string | undefined {
  if (provider === NODARO_IMAGE_UPSCALE_MODEL_ID) return resolveNodaroImageUpscaleFactor(input.upscaleFactor)
  if (provider === "topaz-image-upscale") {
    return resolveTopazUpscale({
      upscaleFactor: typeof input.upscaleFactor === "string" ? input.upscaleFactor : undefined,
      targetResolution: typeof input.targetResolution === "string" ? input.targetResolution : undefined,
    }).upscaleFactor
  }
  return typeof input.upscaleFactor === "string" && !isHouseOnlyUpscaleFactor(input.upscaleFactor) ? input.upscaleFactor : undefined
}

/**
 * The factor a node on `provider` must carry instead of its stored one — the
 * one the run would render ({@link resolveUpscaleFactor}) — `null` when it
 * must carry none, or undefined when the stored factor stands. What the editor
 * writes when a stale factor meets a model that does not take it: a Nodaro
 * Image Upscale 8x switched to Topaz runs, and is stored, at 2x; one switched
 * to a model with no factor list (Recraft) keeps no factor. Any other factor
 * on such a model stands exactly as it always did (a saved Recraft node's "4"
 * is never rewritten), as does none stored, or one the model takes.
 */
export function snappedUpscaleFactor(
  provider: unknown,
  input: { upscaleFactor?: unknown; targetResolution?: unknown },
): string | null | undefined {
  const stored = typeof input.upscaleFactor === "string" ? input.upscaleFactor : undefined
  if (stored === undefined) return undefined
  const factors = upscaleFactorsFor(provider)
  if (!factors) return isHouseOnlyUpscaleFactor(stored) ? null : undefined
  if ((factors as readonly string[]).includes(stored)) return undefined
  return resolveUpscaleFactor(provider, input) ?? null
}
