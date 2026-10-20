/**
 * Suno's stem-group names → Suno Separate's per-stem output fields. Both of
 * KIE's separation lanes (`sunoSeparate` in `suno-client.ts`, the market lane
 * in `suno-separate-market.ts`) return stems by those names; this is the one
 * map they read.
 */

import type { SunoSeparateStemField } from "@nodaro/shared/models"

// Stem-group name (lower-cased, `_` read as a space) → output field.
const STEM_NAME_TO_FIELD: ReadonlyMap<string, SunoSeparateStemField> = new Map([
  ["vocals", "vocalUrl"],
  ["instrumental", "instrumentalUrl"],
  ["backing vocals", "backingVocalsUrl"],
  ["drums", "drumsUrl"],
  ["bass", "bassUrl"],
  ["guitar", "guitarUrl"],
  ["piano", "pianoUrl"],
  ["keyboard", "keyboardUrl"],
  ["percussion", "percussionUrl"],
  ["strings", "stringsUrl"],
  ["synth", "synthUrl"],
  ["fx", "fxUrl"],
  ["brass", "brassUrl"],
  ["woodwinds", "woodwindsUrl"],
])

/**
 * Output field for a stem Suno returned, by its stem-group name. Some names
 * come with underscores (`Backing_Vocals`), so `_` reads as a space before the
 * case-insensitive lookup. `undefined` for a name with no field.
 */
export function sunoStemFieldFor(stemGroupName: string): SunoSeparateStemField | undefined {
  return STEM_NAME_TO_FIELD.get(stemGroupName.replace(/_/g, " ").trim().toLowerCase())
}
