import {
  LOOK_PREVIEW_SETS,
  SOUND_RENDER_SETS,
  registerLookPreviews,
  registerOwnPickerPictures,
  setPlatformPickerPictures,
  type OwnPickerPicture,
  type OwnPickerPictureSet,
} from "@nodaro/picker-ui"
import { isCloud } from "@/lib/edition"
import { surfaceCatalogImages } from "@/lib/surface-selectors"

/**
 * Decide, once at start (before the first render), which picker pictures this
 * deployment shows. The one place in the app that does:
 * picker-pictures-totality.test.ts keeps every other file off these switches.
 *
 * - The deployment's `catalogs.images` (surface profile) decides first.
 *   Anything but "default" — "none", "own" (the deployment's own pictures,
 *   which arrive with the server's catalogs: `applyServerPickerPictures`
 *   below), or a value this build does not know — shows no platform picture
 *   at all: the self-hosted photos, emoji and flags are switched off and no
 *   render is registered. Every picker, card and list then shows what it shows
 *   for an option without a picture. The API decides the same for the catalog
 *   replies (backend lib/picker-images.ts).
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

/**
 * The deployment's own pictures, under "own" only: read from the server's
 * catalog projection (`GET /v1/catalogs`, fetched at start by
 * catalog-bootstrap.ts), which carries them as each option's `imageUrl` and
 * `imageLargeUrl`. The server's one picture decider put them there (backend
 * lib/picker-images.ts), so the editor shows exactly what the API serves; the
 * server sends that body whenever the deployment shows pictures of its own.
 * Under any other value this registers nothing, whatever the reply carries:
 * under "default" the platform's pictures were decided above, and under
 * "none" nothing shows.
 *
 * They land after the first render; whatever draws them subscribes (picker-ui
 * own-pictures.ts). Only https addresses are taken (the server registers no
 * other). Returns how many options got a picture.
 */
export function applyServerPickerPictures(catalogs: unknown): number {
  if (surfaceCatalogImages() !== "own") return 0
  const sets = ownPictureSets(catalogs)
  registerOwnPickerPictures(sets)
  return sets.reduce((n, set) => n + Object.keys(set.pictures).length, 0)
}

/** Each catalog's pictured options, from the projection's `imageUrl` / `imageLargeUrl`. */
function ownPictureSets(catalogs: unknown): OwnPickerPictureSet[] {
  if (!Array.isArray(catalogs)) return []
  const sets: OwnPickerPictureSet[] = []
  for (const raw of catalogs) {
    if (!isRecord(raw) || typeof raw.catalogId !== "string" || typeof raw.nodeType !== "string") continue
    const options = [...listOf(raw.options), ...listOf(raw.dimensions).flatMap((d) => (isRecord(d) ? listOf(d.options) : []))]
    const pictures: Record<string, OwnPickerPicture> = {}
    for (const option of options) {
      if (!isRecord(option) || typeof option.id !== "string" || !isHttps(option.imageUrl)) continue
      pictures[option.id] = isHttps(option.imageLargeUrl) ? { url: option.imageUrl, largeUrl: option.imageLargeUrl } : { url: option.imageUrl }
    }
    if (Object.keys(pictures).length > 0) sets.push({ catalogId: raw.catalogId, lookKey: lookKeyOf(raw.catalogId, raw.nodeType), pictures })
  }
  return sets
}

/**
 * The key LookArt reads a picker's pictures by, for a picker the platform draws
 * through LookArt: the key its renders use (a look picker's node type, a music
 * / voice picker's catalog id). Any other picker gets none there: its pictures
 * show only where the platform's would (the character photos, by catalog id).
 */
function lookKeyOf(catalogId: string, nodeType: string): string | undefined {
  if (Object.hasOwn(LOOK_PREVIEW_SETS, nodeType)) return nodeType
  if (Object.hasOwn(SOUND_RENDER_SETS, catalogId)) return catalogId
  return undefined
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v)
}

function listOf(v: unknown): readonly unknown[] {
  return Array.isArray(v) ? v : []
}

function isHttps(v: unknown): v is string {
  if (typeof v !== "string") return false
  try {
    return new URL(v).protocol === "https:"
  } catch {
    return false
  }
}
