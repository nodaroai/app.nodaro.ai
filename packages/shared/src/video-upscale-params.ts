/**
 * The Video Upscale node's target resolution, per provider, from the catalog.
 *
 * The node stores one `targetResolution` for every provider, and the providers
 * take different sets: Topaz 720p / 1080p / 4K (a short side, its own list in
 * `topaz-video.ts`), Nodaro Video Upscale 1080p / 2K / 4K (an output box), the
 * VEO and Seedance HD upscales none. For a provider whose catalog entry
 * declares its resolutions (`resolutions`, `defaultResolution`; today Nodaro
 * Video Upscale), this is the one coercion every lane applies — a node written
 * straight into workflow JSON, a request to the API and an MCP call never pass
 * through the editor's menus: a value it does not take becomes its default. A
 * provider whose entry declares none (Topaz included) is left alone: its run
 * reads the field by its own rules.
 */
import { MODEL_CATALOG, normalizeModelInput, type ModelInputAdjustment } from "./model-catalog.js"

/**
 * Every target resolution some Video Upscale provider takes — Nodaro Video
 * Upscale's route schema and the MCP verb's enum. Which ones a provider takes:
 * its catalog entry's `resolutions` where it declares them
 * ({@link normalizeVideoUpscaleResolution}), else its own list (Topaz's).
 */
export const VIDEO_UPSCALE_RESOLUTIONS = ["720p", "1080p", "2k", "4k"] as const
export type VideoUpscaleResolution = (typeof VIDEO_UPSCALE_RESOLUTIONS)[number]

/** The provider a Video Upscale node runs when it names none. */
const DEFAULT_VIDEO_UPSCALE_PROVIDER = "topaz"

/**
 * Video Upscale's `provider` value as the catalog model it runs: its "topaz"
 * is the catalog's `topaz-video`; every other value is its own id.
 */
export function videoUpscaleModelOf(provider: string): string {
  return provider === "topaz" ? "topaz-video" : provider
}

/** The resolutions a Video Upscale provider's catalog entry declares, in its order; empty when it declares none (Topaz keeps its own list). */
export function videoUpscaleResolutionsFor(provider: string | undefined): readonly string[] {
  const id = videoUpscaleModelOf(provider || DEFAULT_VIDEO_UPSCALE_PROVIDER)
  return MODEL_CATALOG[id]?.resolutions ?? []
}

export interface NormalizedVideoUpscaleResolution {
  /** The value to store and send: the one asked for, its canonical spelling, or the provider's default. */
  readonly targetResolution: string | undefined
  /** What changed, when anything did. */
  readonly adjustment?: ModelInputAdjustment
}

/**
 * `targetResolution` coerced to one `provider` takes. Unset stays unset (each
 * run applies its own default). A value the provider does not list becomes the
 * provider's `defaultResolution`, a spelling variant ("2K") its canonical form.
 * A provider with no resolution setting gets the value back unchanged; a value
 * that is not a string, or an empty one, reads as unset.
 */
export function normalizeVideoUpscaleResolution(
  provider: string | undefined,
  targetResolution: unknown,
): NormalizedVideoUpscaleResolution {
  if (typeof targetResolution !== "string" || targetResolution === "") return { targetResolution: undefined }
  const id = videoUpscaleModelOf(provider || DEFAULT_VIDEO_UPSCALE_PROVIDER)
  if ((MODEL_CATALOG[id]?.resolutions ?? []).length === 0) return { targetResolution }
  const normalized = normalizeModelInput(id, { resolution: targetResolution })
  const adjustment = normalized.adjustments.find((a) => a.field === "resolution")
  return adjustment ? { targetResolution: normalized.resolution, adjustment } : { targetResolution: normalized.resolution }
}
