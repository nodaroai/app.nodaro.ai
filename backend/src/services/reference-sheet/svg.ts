/** Escape XML-significant characters for safe inclusion in SVG text/attributes. */
export function escapeSvgText(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;")
}

/** Greedy word-wrap to a max characters-per-line budget (approximate; the
 *  renderer uses a generous budget so lines don't overflow their box). */
export function wrapText(text: string, maxCharsPerLine: number): string[] {
  const words = text.split(/\s+/).filter(Boolean)
  const lines: string[] = []
  let current = ""
  for (const word of words) {
    if (current === "") current = word
    else if (current.length + 1 + word.length <= maxCharsPerLine) current += " " + word
    else { lines.push(current); current = word }
  }
  if (current) lines.push(current)
  return lines
}

export interface SvgTextOpts {
  x: number
  y: number
  content: string
  size: number
  fill: string
  family: string
  weight?: number | "bold" | "normal"
  anchor?: "start" | "middle" | "end"
  letterSpacing?: number
}

/** Build a single <text> element with escaped content. */
export function svgText(o: SvgTextOpts): string {
  const weight = o.weight ?? "normal"
  const anchor = o.anchor ?? "start"
  const ls = o.letterSpacing ? ` letter-spacing="${o.letterSpacing}"` : ""
  return (
    `<text x="${o.x}" y="${o.y}" font-family="${o.family}" font-size="${o.size}" ` +
    `font-weight="${weight}" text-anchor="${anchor}" fill="${o.fill}"${ls}>${escapeSvgText(o.content)}</text>`
  )
}
