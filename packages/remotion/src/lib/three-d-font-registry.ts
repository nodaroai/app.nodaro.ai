/**
 * Bundled typeface.json font registry for 3D Title compositions.
 * Text3D in Three.js requires typeface.json format (NOT TTF/OTF).
 *
 * Fonts are served from public/fonts/ via Remotion's staticFile().
 * This avoids network fetches to external CDNs during rendering.
 */
import { staticFile } from "remotion"

const BUNDLED_FONTS: Record<string, string> = {
  helvetiker: staticFile("fonts/helvetiker_regular.typeface.json"),
}

export const DEFAULT_3D_FONT = "helvetiker"

export const BUNDLED_3D_FONT_NAMES = Object.keys(BUNDLED_FONTS)

/**
 * Resolve a font name or URL to a typeface.json path.
 * - HTTP(S) URL → returned as-is
 * - Known bundled font name → local static path
 * - Unknown name → fallback to default font
 */
export function resolve3DFontPath(fontNameOrUrl: string): string {
  if (fontNameOrUrl.startsWith("http")) {
    return fontNameOrUrl
  }

  const key = fontNameOrUrl.toLowerCase().trim()
  if (BUNDLED_FONTS[key]) {
    return BUNDLED_FONTS[key]
  }

  // Case-insensitive partial match
  for (const [name, path] of Object.entries(BUNDLED_FONTS)) {
    if (name.includes(key) || key.includes(name)) {
      return path
    }
  }

  return BUNDLED_FONTS[DEFAULT_3D_FONT]
}
