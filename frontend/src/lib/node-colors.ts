/** Shared color constants and helpers for text-prompt and sticky-note nodes. */

// First 3 stay as muted dark navy / blue / green for low-contrast nodes
// that should fade into the canvas. The last 3 pull from the brand palette
// (brand pink, purple, cyan) at 25% alpha so they read as bright + tinted
// in dark mode without overwhelming the surrounding chips — the alpha
// blends them onto the canvas bg the same way Tailwind's `/25` color
// utilities do.
export const NODE_COLORS = [
  "#0f172a", "#1e3a5f", "#1a2e1a",
  "#ff007340", "#A855F740", "#22D3EE40",
]

export const LIGHT_COLORS_MAP: Record<string, string> = {
  "#0f172a": "#f1f5f9",
  "#1e3a5f": "#dbeafe",
  "#1a2e1a": "#dcfce7",
  // Light-mode counterparts for the bright/alpha palette entries above.
  // Drop the alpha and pick the matching shade-50/100 from the palette
  // family so the swatch reads as the same hue in both themes.
  "#ff007340": "#fce7f3",
  "#A855F740": "#f3e8ff",
  "#22D3EE40": "#cffafe",
}

export function adjustColor(hex: string, amount: number): string {
  const color = hex.replace("#", "")
  if (color.length !== 6) return hex
  const num = parseInt(color, 16)
  const r = Math.min(255, Math.max(0, (num >> 16) + amount))
  const g = Math.min(255, Math.max(0, ((num >> 8) & 0x00ff) + amount))
  const b = Math.min(255, Math.max(0, (num & 0x0000ff) + amount))
  return `#${(1 << 24 | r << 16 | g << 8 | b).toString(16).slice(1)}`
}

/** Get the effective color for a node based on the current theme. */
export function getEffectiveColor(color: string, isDark: boolean): string {
  return isDark ? color : (LIGHT_COLORS_MAP[color] ?? color)
}
