/**
 * Hex-color lookups for Person catalog entries that describe a colour.
 *
 * Person hair-color, skin-tone, and eye-color entries are semantically
 * *colors* — the entry label is a color name. Labels alone don't help
 * distinguish "auburn" from "chestnut" or "olive" from "tan"; a small
 * swatch does. Rather than thread a `color` field through the shared
 * Person catalog (and make it required just for a UI concern), the
 * colour lookup lives here, where it's consumed.
 *
 * Where a colour is a gradient (salt-and-pepper, dyed), we return a
 * two-stop `linear-gradient` string so the swatch renderer can apply it
 * via `background` rather than `background-color`.
 */

export type SwatchValue = { solid: string } | { gradient: string }

export const HAIR_COLOR_SWATCH: Readonly<Record<string, SwatchValue>> = {
  "hair-platinum":    { solid: "#e9e1c9" },
  "hair-creamy":      { solid: "#e5cfa0" },
  "hair-blonde":      { solid: "#d9b881" },
  "hair-honey":       { solid: "#c89a56" },
  "hair-strawberry":  { solid: "#d08e6a" },
  "hair-ash-blonde":  { solid: "#c2b18a" },
  "hair-ginger":      { solid: "#c86a30" },
  "hair-copper":      { solid: "#b26036" },
  "hair-red":         { solid: "#9e3a1a" },
  "hair-auburn":      { solid: "#7b3418" },
  "hair-burgundy":    { solid: "#4a1616" },
  "hair-light-brown": { solid: "#8b6b4a" },
  "hair-caramel":     { solid: "#7a4f2a" },
  "hair-brown":       { solid: "#5a3e2b" },
  "hair-chestnut":    { solid: "#6b3d23" },
  "hair-chocolate":   { solid: "#3e2617" },
  "hair-dark-brown":  { solid: "#2a1a0f" },
  "hair-black":       { solid: "#1a1a1a" },
  "hair-jet-black":   { solid: "#0a0d14" },
  "hair-gray":        { solid: "#9a9a9a" },
  "hair-salt-pepper": { gradient: "linear-gradient(135deg, #1a1a1a 0%, #1a1a1a 45%, #c0c0c0 55%, #c0c0c0 100%)" },
  "hair-white":       { solid: "#f4f3ed" },
  "hair-dyed":        { gradient: "linear-gradient(90deg, #ff0080 0%, #8a2be2 33%, #00bfff 66%, #32cd32 100%)" },
}

export const SKIN_TONE_SWATCH: Readonly<Record<string, SwatchValue>> = {
  "skin-very-fair": { solid: "#f7e0c9" },
  "skin-fair":      { solid: "#f0c9a4" },
  "skin-medium":    { solid: "#d6a57a" },
  "skin-olive":     { solid: "#b48862" },
  "skin-tan":       { solid: "#a56e43" },
  "skin-brown":     { solid: "#78482b" },
  "skin-dark":      { solid: "#3a2417" },
}

export const EYE_COLOR_SWATCH: Readonly<Record<string, SwatchValue>> = {
  "eyes-brown":  { solid: "#5a3821" },
  "eyes-blue":   { solid: "#2f6ea8" },
  "eyes-green":  { solid: "#3a8a4e" },
  "eyes-hazel":  { gradient: "radial-gradient(circle, #a8853a 0%, #5a3821 100%)" },
  "eyes-gray":   { solid: "#8a9099" },
  "eyes-amber":  { solid: "#c88338" },
}

/** Lookup across all Person color dimensions. Returns undefined when the
 *  entry id has no colour mapping (e.g. hair-style / build entries). */
export function getPersonSwatch(id: string | undefined | null): SwatchValue | undefined {
  if (!id) return undefined
  return (
    HAIR_COLOR_SWATCH[id] ??
    SKIN_TONE_SWATCH[id] ??
    EYE_COLOR_SWATCH[id]
  )
}
