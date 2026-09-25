import { CHARACTER_ART_FILES } from "./character-art-files.generated.js"
import { SOUND_ART } from "./sound-art-map.js"
import { SOUND_ART_FILES } from "./sound-art-files.generated.js"

/**
 * Where every self-hosted picker picture lives, relative to the app's origin:
 * `frontend/public/picker-art/` is served at `/picker-art/` in every edition
 * (content-hashed names, cached as immutable). The editor's pickers use these
 * paths as they are (same origin); the API makes them absolute (images.ts).
 * The maps they read are the single source for both.
 */
export const PICKER_ART_PATH = "/picker-art/"
export const CHARACTER_ART_PATH = "/picker-art/character/"

/** The picker catalogs (by catalog id) whose options have photos. */
export type CharacterArtFamily = "person" | "styling" | "held-prop" | "materials" | "animals"

export const CHARACTER_ART_FAMILIES: ReadonlyArray<CharacterArtFamily> = ["person", "styling", "held-prop", "materials", "animals"]

const SECTIONS_FAMILY = "sections"

function characterFile(family: string, id: string): string | undefined {
  const stem = CHARACTER_ART_FILES[family]?.[id]
  return stem ? `${CHARACTER_ART_PATH}${family}/${stem}.webp` : undefined
}

/** A character picker option's photo, root-relative — or undefined (no photo, or not a character catalog). */
export function characterArtPath(family: string, id: string): string | undefined {
  return family === SECTIONS_FAMILY ? undefined : characterFile(family, id)
}

/** "Skin & Eyes" → "skin-eyes": the file name of a topic's round icon. */
export function characterSectionSlug(sectionLabel: string): string {
  return sectionLabel.toLowerCase().replace(/&/g, " ").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")
}

/** The round icon of a Person / Styling topic (by its English label), root-relative — or undefined. */
export function characterSectionArtPath(sectionLabel: string): string | undefined {
  return characterFile(SECTIONS_FAMILY, characterSectionSlug(sectionLabel))
}

/** A music / voice art asset key (`emoji/<slug>` / `flags/<code>`) → its root-relative file, or undefined. */
export function soundArtFilePath(key: string): string | undefined {
  const file = (SOUND_ART_FILES as Readonly<Record<string, string>>)[key]
  return file ? PICKER_ART_PATH + file : undefined
}

/** A music / voice picker option's picture, root-relative — or undefined. */
export function soundArtPath(catalogId: string, field: string, id: string): string | undefined {
  const byField = (SOUND_ART as Readonly<Record<string, Readonly<Record<string, Readonly<Record<string, string>>>>>>)[catalogId]
  const key = byField?.[field]?.[id]
  return key ? soundArtFilePath(key) : undefined
}
