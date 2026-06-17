/**
 * Facets of a source character/asset that can be selectively injected into a
 * consumer character via the Character node's Assets handle (element/asset
 * injection, P2). Single source of truth for the frontend facet chip options
 * AND the backend facet-extraction instructions.
 *
 * `full` injects the whole source description verbatim (no LLM call needed).
 * Every other facet is LLM-extracted on demand from the source's
 * `canonicalDescription` via `POST /v1/character/extract-facet`.
 */
export interface CharacterFacet {
  /** Stable id stored on the connection (`assetInjections[].facet`). */
  readonly id: string
  /** Human label shown in the facet chip. */
  readonly label: string
  /** What the extractor should pull from the source description. Phrased to
   *  complete "Extract {instruction} …". Unused for `full`. */
  readonly instruction: string
}

export const CHARACTER_FACETS: readonly CharacterFacet[] = [
  { id: "full", label: "Full likeness", instruction: "the complete physical likeness and appearance" },
  { id: "hair", label: "Hair", instruction: "ONLY the hair — style, length, colour, and texture" },
  { id: "skin-tone", label: "Skin tone", instruction: "ONLY the skin tone / complexion" },
  { id: "face", label: "Face", instruction: "ONLY the facial features — face shape, eyes, nose, mouth, eyebrows, and any distinguishing marks" },
  { id: "style", label: "Style", instruction: "ONLY the overall visual style, aesthetic, and vibe — not specific garments" },
  { id: "outfit", label: "Outfit", instruction: "ONLY the clothing, outfit, and wardrobe" },
  { id: "personality", label: "Personality", instruction: "ONLY the personality, demeanour, and characteristic expression" },
] as const

export const DEFAULT_CHARACTER_FACET = "full"

export const CHARACTER_FACET_IDS: ReadonlySet<string> = new Set(CHARACTER_FACETS.map((f) => f.id))

export function getCharacterFacet(id: string): CharacterFacet | undefined {
  return CHARACTER_FACETS.find((f) => f.id === id)
}
