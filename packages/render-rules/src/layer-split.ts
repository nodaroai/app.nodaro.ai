/**
 * Split into Layers' run rules — one image in, a base picture and its layers
 * out — read alike by the editor (the node, its config panel, the Run price)
 * and the server (the route, the workflow payload, the worker, price.ee.ts).
 * Pure, with no node type in it: each caller passes the unit's own type (its
 * generated definition / descriptor), so the type id stays in the unit's folders.
 *
 * Prices are not here: the credit ids name rows of the unit's price.ee.ts and
 * its model_pricing seed. A run holds the row for the most images it may return
 * (the layers it may make, plus the base) and settles on the row for the images
 * it really returned.
 */

/** The sizes a run may ask for: a pixel budget per image (each layer is cropped to its element at about that many pixels), or `auto` — the picture's own size, between 1K and 2K. */
export const LAYER_SPLIT_SIZES = ["1K", "1.5K", "2K", "auto"] as const
export type LayerSplitSize = (typeof LAYER_SPLIT_SIZES)[number]
/** The size a run asks for when none is set. */
export const LAYER_SPLIT_DEFAULT_SIZE: LayerSplitSize = "1K"

/** "Max layers": how many layers a run may make (the base comes on top). More elements than this merge into fewer layers; none are dropped. */
export const LAYER_SPLIT_MAX_LAYERS = { min: 1, max: 99, default: 9 } as const
/** The most images one run returns: the most layers plus the base. */
export const LAYER_SPLIT_MAX_IMAGES = LAYER_SPLIT_MAX_LAYERS.max + 1

/** The longest "what to separate" description, in characters. */
export const LAYER_SPLIT_PROMPT_MAX = 2000

/** The price tier of a size: 1K and 1.5K bill alike, 2K and `auto` alike. */
export type LayerSplitTier = "1k" | "2k"
export const LAYER_SPLIT_TIERS: readonly LayerSplitTier[] = ["1k", "2k"]

const isSize = (v: unknown): v is LayerSplitSize => typeof v === "string" && (LAYER_SPLIT_SIZES as readonly string[]).includes(v)

/** The size a node's data asks for: one of LAYER_SPLIT_SIZES, else the default. */
export function layerSplitSize(size: unknown): LayerSplitSize {
  return isSize(size) ? size : LAYER_SPLIT_DEFAULT_SIZE
}

/** The tier a size bills at. */
export function layerSplitTier(size: unknown): LayerSplitTier {
  const s = layerSplitSize(size)
  return s === "2K" || s === "auto" ? "2k" : "1k"
}

/** "Max layers" from a node's data: a whole number from 1 to 99, else the default (a fraction rounds down). */
export function layerSplitMaxLayers(v: unknown): number {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : Number.NaN
  if (!Number.isFinite(n)) return LAYER_SPLIT_MAX_LAYERS.default
  return Math.min(LAYER_SPLIT_MAX_LAYERS.max, Math.max(LAYER_SPLIT_MAX_LAYERS.min, Math.floor(n)))
}

/** The most images a run may return for its "Max layers": the layers plus the base (2 to 100) — what the provider is asked for, and what a run holds. */
export function layerSplitImagesHeld(maxLayers: unknown): number {
  return layerSplitMaxLayers(maxLayers) + 1
}

/** The credit id of `images` images (1 to 100, the base included) at `tier`, for the unit of type `type`. */
export function layerSplitCreditId(type: string, tier: LayerSplitTier, images: number): string {
  const k = Math.min(LAYER_SPLIT_MAX_IMAGES, Math.max(1, Math.floor(images)))
  return `${type}:${tier}:${k}`
}

/** The credit id a run of `data` holds: its size's tier, at the most images it may return. */
export function layerSplitHoldCreditId(type: string, data: Readonly<Record<string, unknown>> | null | undefined): string {
  return layerSplitCreditId(type, layerSplitTier(data?.size), layerSplitImagesHeld(data?.maxLayers))
}

/** Every credit id of the unit (2 tiers × 1 to 100 images), in order — what price.ee.ts and its seed list. */
export function layerSplitCreditIds(type: string): string[] {
  return LAYER_SPLIT_TIERS.flatMap((tier) => Array.from({ length: LAYER_SPLIT_MAX_IMAGES }, (_, i) => layerSplitCreditId(type, tier, i + 1)))
}

/** A "what to separate" description as a run sends it: trimmed, no longer than LAYER_SPLIT_PROMPT_MAX; undefined when empty (the model then finds the main elements itself). */
export function layerSplitPrompt(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined
  const s = v.trim()
  return s === "" ? undefined : s.slice(0, LAYER_SPLIT_PROMPT_MAX)
}
