import {
  CHARACTER_ART_FILES,
  CHARACTER_ART_PATH,
  characterArtPath,
  characterSectionArtPath,
  characterSectionSlug,
  type CharacterArtFamily,
} from "@nodaro/prompts"

/**
 * Photos for the options of the character pickers (Person, Styling, Held Prop,
 * Material, Animal) and the round icons of their topics.
 *
 * The files are self-hosted under `frontend/public/picker-art/character/`
 * (built by tools/picker-art/character-art.mts), so they load same-origin in
 * every edition, offline installs included. Their names carry a content hash,
 * which is what lets the server cache them as immutable.
 *
 * One photo per option id: the key is the picker catalog id + the option id,
 * so there is no hand-kept map to drift. The map and the path rules live in
 * @nodaro/prompts (picker-art/), the single source the API reads too. An option
 * without a photo (added after the art was made) renders its fallback
 * wherever the photo would be.
 */
export type { CharacterArtFamily }
export { characterSectionSlug }

/** Root-relative, so the picture is always served by the app's own origin. */
export const CHARACTER_ART_BASE = CHARACTER_ART_PATH

/** The photo of one option, or undefined (the caller shows its fallback). */
export function characterArtUrl(family: CharacterArtFamily, id: string): string | undefined {
  return characterArtPath(family, id)
}

/** Whether any option of the family has a photo. */
export function hasCharacterArt(family: string): family is CharacterArtFamily {
  return family !== "sections" && Object.keys(CHARACTER_ART_FILES[family] ?? {}).length > 0
}

/** The round icon of a picker topic (by its English label), or undefined. */
export function characterSectionIconUrl(sectionLabel: string): string | undefined {
  return characterSectionArtPath(sectionLabel)
}

/**
 * How a dimension's tiles frame its photos. Most are square, cropped from the
 * top (faces and heads sit high). Type is shown tall (3:4), as the design has
 * it; the four-view hair strips and the face + zoomed-skin pairs lose their
 * subject when squared, so they keep their wide shape.
 */
export type CharacterArtShape = "square" | "portrait" | "wide" | "strip"

const SHAPES: Readonly<Record<string, CharacterArtShape>> = {
  "person/type": "portrait",
  "person/skin-texture": "wide",
  "person/hair-base": "strip",
}

/** The "<family>/<dimension>" keys that set a shape (a guard test checks they name real dimensions). */
export const CHARACTER_ART_SHAPED_DIMENSIONS: ReadonlyArray<string> = Object.keys(SHAPES)

export function characterArtShape(family: CharacterArtFamily, dimension?: string): CharacterArtShape {
  return (dimension && SHAPES[`${family}/${dimension}`]) || "square"
}

/**
 * Where a small square thumbnail (a picked chip, the canvas card) crops a
 * photo of this shape: the front view of a hair strip sits on its left, the
 * zoomed skin on the right of a skin pair.
 */
export const CHARACTER_THUMB_POSITION: Readonly<Record<CharacterArtShape, string>> = {
  square: "50% 25%",
  portrait: "50% 20%",
  wide: "100% 50%",
  strip: "0% 50%",
}
