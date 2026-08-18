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
  "hair-silver":      { solid: "#c0c4c8" },
  "hair-rose-gold":   { solid: "#d4a78f" },
  "hair-dyed":        { gradient: "linear-gradient(90deg, #ff0080 0%, #8a2be2 33%, #00bfff 66%, #32cd32 100%)" },
  "hair-blue":        { solid: "#1e90ff" },
  "hair-pastel-blue": { solid: "#a8d8e8" },
  "hair-teal":        { solid: "#26999e" },
  "hair-mint":        { solid: "#a8e6c5" },
  "hair-green":       { solid: "#3aa84a" },
  "hair-lavender":    { solid: "#b794d8" },
  "hair-purple":      { solid: "#6b4ba8" },
  "hair-magenta":     { solid: "#cc2c80" },
  "hair-pink":        { solid: "#e85d8e" },
  "hair-pastel-pink": { solid: "#f9c2cf" },
  "hair-peach":       { solid: "#f4b896" },
  "hair-mermaid":     { gradient: "linear-gradient(135deg, #1ec0c0 0%, #6b4ba8 50%, #e85d8e 100%)" },
  "hair-rainbow":     { gradient: "linear-gradient(90deg, #ff0000 0%, #ff8000 16%, #ffd700 32%, #3aa84a 48%, #1e90ff 64%, #6b4ba8 80%, #cc2c80 100%)" },
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
  "eyes-brown":     { solid: "#5a3821" },
  "eyes-blue":      { solid: "#2f6ea8" },
  "eyes-green":     { solid: "#3a8a4e" },
  "eyes-hazel":     { gradient: "radial-gradient(circle, #a8853a 0%, #5a3821 100%)" },
  "eyes-gray":      { solid: "#8a9099" },
  "eyes-amber":     { solid: "#c88338" },
  "eyes-gold":      { solid: "#d4a93a" },
  "eyes-silver":    { solid: "#c0c4c8" },
  "eyes-turquoise": { solid: "#1ec0c0" },
  "eyes-violet":    { solid: "#8e6dc6" },
  "eyes-pink":      { solid: "#d27a8a" },
  "eyes-red":       { solid: "#9e2828" },
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
