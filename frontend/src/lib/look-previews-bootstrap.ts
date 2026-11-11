import { LOOK_PREVIEW_SETS, SOUND_RENDER_SETS, registerLookPreviews, setPlatformPickerPictures } from "@nodaro/picker-ui"
import { isCloud } from "@/lib/edition"
import { surfaceCatalogImages } from "@/lib/surface-selectors"

/**
 * Decide, once at start (before the first render), which picker pictures this
 * deployment shows. The one place in the app that does:
 * picker-pictures-totality.test.ts keeps every other file off these switches.
 *
 * - The deployment's `catalogs.images` (surface profile) decides first.
 *   Anything but "default" — "none", "own" (the deployment's own pictures, which
 *   have no registry yet, so none), or a value this build does not know —
 *   shows no platform picture at all: the self-hosted photos, emoji and flags
 *   are switched off and no render is registered. Every picker, card and list
 *   then shows what it shows for an option without a picture. The API decides
 *   the same for the catalog replies (backend lib/picker-images.ts).
 * - Under "default" (or no setting), every edition shows the self-hosted
 *   pictures, and the rendered previews — the look pickers' (Style, Lens,
 *   Framing, …) and the music / voice pickers' (Music Genre, Music Mood,
 *   Instrumentation, Voice Character, Voice Delivery) — are registered on
 *   Nodaro Cloud only. They live on the Nodaro CDN; a self-hosted install
 *   (Community / Business) never calls it and keeps the drawn previews, 3D
 *   emoji and flags every picker ships with.
 */
export function bootstrapLookPreviews(): void {
  const platformPictures = surfaceCatalogImages() === "default"
  setPlatformPickerPictures(platformPictures)
  if (platformPictures && isCloud()) registerLookPreviews({ ...LOOK_PREVIEW_SETS, ...SOUND_RENDER_SETS })
}
