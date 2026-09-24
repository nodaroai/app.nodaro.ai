import { SOUND_ART } from "./sound-art-map"
import { SOUND_ART_FILES } from "./sound-art-files.generated"

/**
 * Pictures for the options of the five music / voice pickers (Music Genre,
 * Music Mood, Instrumentation, Voice Character, Voice Delivery).
 *
 * The files are self-hosted under `frontend/public/picker-art/` (Fluent Emoji
 * 3D and flag-icons, both MIT — see the LICENSE.txt beside them), so they load
 * same-origin in every edition, offline installs included. Their names carry a
 * content hash, which is what lets the server cache them as immutable.
 */

/** The dimension fields of each catalog that carries art. */
export interface SoundArtFields {
  "music-genre": "genre" | "subgenre" | "era"
  "music-mood": "energy" | "emotion" | "vibe"
  instrumentation: "instruments" | "production" | "vocalPresence" | "singingStyle"
  "voice-character": "age" | "gender" | "language" | "accent" | "timbre"
  "voice-delivery": "pace" | "emotion" | "archetype"
}

export type SoundArtCatalogId = keyof SoundArtFields

/** `emoji/<slug>` or `flags/<code>` — a key of SOUND_ART_FILES. */
export type SoundArtKey = `emoji/${string}` | `flags/${string}`

export type SoundArtMap = {
  readonly [C in SoundArtCatalogId]: {
    readonly [F in SoundArtFields[C]]: Readonly<Record<string, SoundArtKey>>
  }
}

/** Which catalog dimension a picker section renders — typos fail `tsc`. */
export type SoundArtRef = {
  [C in SoundArtCatalogId]: { readonly catalogId: C; readonly field: SoundArtFields[C] }
}[SoundArtCatalogId]

export interface SoundArt {
  readonly url: string
  readonly kind: "emoji" | "flag"
}

/** Root-relative, so the picture is always served by the app's own origin. */
export const SOUND_ART_BASE = "/picker-art/"

export function soundArtUrl(key: SoundArtKey): string | undefined {
  const file = (SOUND_ART_FILES as Readonly<Record<string, string>>)[key]
  return file ? SOUND_ART_BASE + file : undefined
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
