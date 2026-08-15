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

/**
 * Ink (text) colours for tinted nodes, keyed by which ink reads on the
 * surface — NOT by theme. `light` ink goes on dark surfaces, `dark` ink on
 * light ones. Values are the same slate-800 / white-80 pairs the nodes used
 * to pick by theme; only the selection rule changed.
 */
export const INK = {
  light: {
    text: "rgba(255, 255, 255, 0.8)",
    placeholder: "rgba(255, 255, 255, 0.25)",
  },
  dark: {
    text: "rgb(30, 41, 59)",
    placeholder: "rgb(148, 163, 184)",
  },
} as const

export type Ink = keyof typeof INK

/** Canvas backgrounds an alpha tint composites onto (globals.css). */
const CANVAS_BG = { dark: "#121212", light: "#F8FAFC" } as const

function parseHex(hex: string): { r: number; g: number; b: number; a: number } | null {
  const m = /^#([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(hex.trim())
  if (!m) return null
  const num = parseInt(m[1], 16)
  return {
    r: (num >> 16) & 0xff,
    g: (num >> 8) & 0xff,
    b: num & 0xff,
    a: m[2] ? parseInt(m[2], 16) / 255 : 1,
  }
}

/** WCAG relative luminance of an opaque sRGB colour. */
function luminance(r: number, g: number, b: number): number {
  const lin = (c: number) => {
    const s = c / 255
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)
  }
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
}

/**
 * Which ink reads on `surface`. Decided from the surface's luminance, so a
 * tinted node stays legible whatever colour it carries and whichever theme
 * is active — a theme-fixed rule ("dark text in light mode") breaks the
 * moment a colour has no light-mode counterpart (imports, agents, older
 * seeds), which is how the Welcome Demo notes became slate-on-navy.
 *
 * Alpha tints (the bright palette entries) are composited over the theme
 * canvas first, since that is what the eye actually sees. Unparseable input
 * falls back to the theme default.
 */
export function readableInk(surface: string, isDark: boolean): Ink {
  const rgba = parseHex(surface)
  if (!rgba) return isDark ? "light" : "dark"
  const canvas = parseHex(isDark ? CANVAS_BG.dark : CANVAS_BG.light)!
  const r = rgba.r * rgba.a + canvas.r * (1 - rgba.a)
  const g = rgba.g * rgba.a + canvas.g * (1 - rgba.a)
  const b = rgba.b * rgba.a + canvas.b * (1 - rgba.a)
  // 0.179 is the luminance at which black and white text have equal contrast.
  return luminance(r, g, b) > 0.179 ? "dark" : "light"
}
