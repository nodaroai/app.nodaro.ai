/**
 * Bundled typeface.json font registry for 3D Title compositions.
 * Text3D in Three.js requires typeface.json format (NOT TTF/OTF).
 *
 * The helvetiker font ships with the three.js npm package at:
 *   node_modules/three/examples/fonts/helvetiker_regular.typeface.json
 * We host a copy in public/fonts/ for Remotion rendering.
 *
 * CDN URLs are also accepted as fallbacks.
 */

const HELVETIKER_CDN =
  "https://raw.githubusercontent.com/mrdoob/three.js/dev/examples/fonts/helvetiker_regular.typeface.json"

const BUNDLED_FONTS: Record<string, string> = {
  helvetiker: HELVETIKER_CDN,
}

export const DEFAULT_3D_FONT = "helvetiker"

export const BUNDLED_3D_FONT_NAMES = Object.keys(BUNDLED_FONTS)

/**
 * Resolve a font name or URL to a typeface.json path.
 * - HTTP(S) URL → returned as-is
 * - Known bundled font name → CDN/local path
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
