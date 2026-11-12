import { snappedUpscaleFactor } from "@nodaro/shared/credits"

/** The Upscale Image node fields a model switch reads. */
export interface UpscaleFactorSnapFields {
  upscaleFactor?: unknown
  targetResolution?: unknown
}

/** What a switch writes besides the model: the snapped factor, or `undefined` to clear it (`undefined` removes the key on merge). */
export type UpscaleFactorSnapPatch = {
  upscaleFactor: string | undefined
}

/**
 * What to write next to `{ provider: next }` when an Upscale Image node moves
 * to another model, or undefined when its stored factor stands
 * (`snappedUpscaleFactor`, @nodaro/shared): a factor the new model does not
 * take snaps to the one its run renders (a Nodaro Image Upscale 8x on Topaz:
 * 2), and an "8" — which only the house model takes — is cleared from a model
 * with no factor list (Recraft). Any other factor on such a model stands, as
 * it always did. The config panel's dropdown, its fail-safe and the quick
 * strip all write this.
 */
export function upscaleFactorSnapPatch(next: unknown, data: UpscaleFactorSnapFields): UpscaleFactorSnapPatch | undefined {
  const snapped = snappedUpscaleFactor(next, data)
  return snapped === undefined ? undefined : { upscaleFactor: snapped ?? undefined }
}
