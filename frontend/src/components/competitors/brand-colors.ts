import type { CSSProperties } from "react"

/**
 * Each tracked brand's color on the Competitors page: one hue per brand,
 * stable across visits. The page paints it through the `brand-swatch` /
 * `brand-top` classes (globals.css), which pick the light or dark lightness
 * for the hue handed over in `--brand-hue`.
 */

/** Ten hues spread around the wheel; brands take them first. */
export const BRAND_HUES: readonly number[] = [125, 55, 250, 300, 20, 340, 190, 90, 160, 220]
/** Past the ten, each further brand turns this far from the last one. */
const GOLDEN_ANGLE = 137.508

/** A 32-bit FNV-1a hash of the id: the slot a brand prefers. */
function hashOf(id: string): number {
  let hash = 0x811c9dc5
  for (let i = 0; i < id.length; i += 1) {
    hash ^= id.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash >>> 0
}

/**
 * A hue per brand id. Each brand prefers the slot its id hashes to; one added
 * after another that took that slot moves on to the next free one, so a new
 * brand never repaints the others. Past ten brands, golden-angle steps keep
 * the further ones apart. Always a whole number from 0 to 359.
 */
export function brandHues(brands: readonly { readonly id: string; readonly createdAt: string }[]): ReadonlyMap<string, number> {
  const ordered = [...brands].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))
  const taken = new Set<number>()
  const hues = new Map<string, number>()
  let beyond = 0
  for (const brand of ordered) {
    if (taken.size < BRAND_HUES.length) {
      let slot = hashOf(brand.id) % BRAND_HUES.length
      while (taken.has(slot)) slot = (slot + 1) % BRAND_HUES.length
      taken.add(slot)
      hues.set(brand.id, BRAND_HUES[slot]!)
    } else {
      beyond += 1
      hues.set(brand.id, Math.round(BRAND_HUES[0]! + beyond * GOLDEN_ANGLE) % 360)
    }
  }
  return hues
}

/** The inline style that hands a hue to the `brand-*` classes; nothing for no hue. */
export function brandHueStyle(hue: number | undefined): CSSProperties | undefined {
  if (hue === undefined || !Number.isFinite(hue)) return undefined
  return { "--brand-hue": String(Math.round(hue) % 360) } as CSSProperties
}
