/** Shared color constants and helpers for text-prompt and sticky-note nodes. */

export const NODE_COLORS = ["#0f172a", "#1e3a5f", "#1a2e1a", "#2d1a1a", "#2d1a2d", "#1a2d2d"]

export const LIGHT_COLORS_MAP: Record<string, string> = {
  "#0f172a": "#f1f5f9",
  "#1e3a5f": "#dbeafe",
  "#1a2e1a": "#dcfce7",
  "#2d1a1a": "#fee2e2",
  "#2d1a2d": "#f3e8ff",
  "#1a2d2d": "#ccfbf1",
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
