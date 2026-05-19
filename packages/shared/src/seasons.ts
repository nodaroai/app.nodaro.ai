/**
 * Canonical catalog of seasons.
 *
 * 4 universal seasonal labels — used by the Location Studio's Seasons tab
 * and (in the future) by any season-picker parameter node. Independent of
 * lighting (time-of-day), atmosphere (weather), and color/look.
 *
 * Northern-hemisphere reference is implicit. Promp t hints describe the
 * visual hallmarks of each season so downstream generators reproduce them
 * faithfully across diverse settings (interior, exterior, character, etc.).
 */

export interface Season {
  readonly id: string
  readonly label: string
  readonly description: string
  readonly promptHint: string
}

export const SEASONS: ReadonlyArray<Season> = [
  {
    id: "spring",
    label: "Spring",
    description: "Fresh growth, blossoms, mild weather",
    promptHint: "spring season, fresh new growth with green buds and emerging foliage, blossoming flowers, mild fresh air, soft directional sunlight, occasional light rain, pastel color palette of pale greens and pinks",
  },
  {
    id: "summer",
    label: "Summer",
    description: "Full bloom, warm light, lush green",
    promptHint: "summer season, lush full foliage in deep saturated greens, warm bright sunlight with strong overhead sun, deep shadows, vibrant warm color palette, clear blue skies or scattered cumulus clouds",
  },
  {
    id: "autumn",
    label: "Autumn",
    description: "Falling leaves, warm amber palette",
    promptHint: "autumn season, foliage transitioning to warm amber tones — red, orange, yellow, and rust — falling leaves drifting on the breeze, soft golden directional light, crisp cool air with low sun angles",
  },
  {
    id: "winter",
    label: "Winter",
    description: "Bare branches, snow, cool palette",
    promptHint: "winter season, bare branches against a cold sky, snow accumulation on every surface, breath visible in cold air, desaturated cool color palette of blues and grays with isolated warm artificial light sources",
  },
]
