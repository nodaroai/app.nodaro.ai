/**
 * Returns a readable text color (near-black or near-white) for the given
 * background color, based on relative luminance (simplified WCAG formula).
 *
 * @param backgroundColor - A #RGB or #RRGGBB hex string.
 * @returns "#0a0a0a" for light backgrounds (luminance > 0.55) or "#f5f5f7" for dark.
 *          Defaults to "#f5f5f7" (safe on the intended dark bg) if the input is
 *          not a parseable hex.
 */
export function readableTextColor(backgroundColor: string): string {
  const hex = backgroundColor.replace(/^#/, "")
  let r: number, g: number, b: number

  if (hex.length === 3) {
    r = parseInt(hex[0] + hex[0], 16) / 255
    g = parseInt(hex[1] + hex[1], 16) / 255
    b = parseInt(hex[2] + hex[2], 16) / 255
  } else if (hex.length === 6) {
    r = parseInt(hex.slice(0, 2), 16) / 255
    g = parseInt(hex.slice(2, 4), 16) / 255
    b = parseInt(hex.slice(4, 6), 16) / 255
  } else {
    // Not a parseable hex — default to light text (safe on the intended dark bg)
    return "#f5f5f7"
  }

  // Relative luminance (WCAG 2.x, linear channel approximation for hex input)
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b
  return luminance > 0.55 ? "#0a0a0a" : "#f5f5f7"
}
