import {
  PICKER_ART_PATH,
  SOUND_ART,
  soundArtFilePath,
  type SoundArtCatalogId,
  type SoundArtFields,
  type SoundArtKey,
  type SoundArtMap,
} from "@nodaro/prompts"

/**
 * Pictures for the options of the five music / voice pickers (Music Genre,
 * Music Mood, Instrumentation, Voice Character, Voice Delivery).
 *
 * The files are self-hosted under `frontend/public/picker-art/` (Fluent Emoji
 * 3D and flag-icons, both MIT — see the LICENSE.txt beside them), so they load
 * same-origin in every edition, offline installs included. Their names carry a
 * content hash, which is what lets the server cache them as immutable. The map
 * lives in @nodaro/prompts (picker-art/), the single source the API reads too.
 */
export type { SoundArtCatalogId, SoundArtFields, SoundArtKey, SoundArtMap }

/** Which catalog dimension a picker section renders — typos fail `tsc`. */
export type SoundArtRef = {
  [C in SoundArtCatalogId]: { readonly catalogId: C; readonly field: SoundArtFields[C] }
}[SoundArtCatalogId]

export interface SoundArt {
  readonly url: string
  readonly kind: "emoji" | "flag"
}

/** Root-relative, so the picture is always served by the app's own origin. */
export const SOUND_ART_BASE = PICKER_ART_PATH

export function soundArtUrl(key: SoundArtKey): string | undefined {
  return soundArtFilePath(key)
}

/** The picture for one option, or undefined (the tile then shows its label only). */
export function getSoundArt(ref: SoundArtRef, id: string): SoundArt | undefined {
  const byField = SOUND_ART[ref.catalogId] as Readonly<Record<string, Readonly<Record<string, SoundArtKey>>>>
  const key = byField[ref.field]?.[id]
  if (!key) return undefined
  const url = soundArtUrl(key)
  if (!url) return undefined
  return { url, kind: key.startsWith("flags/") ? "flag" : "emoji" }
}

export { SOUND_ART }
