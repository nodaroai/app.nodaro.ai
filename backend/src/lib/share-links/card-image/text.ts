/**
 * Text on a share card's picture (pure). The server's image has two font
 * families (DejaVu and Liberation), which cover the Latin, Greek, Cyrillic and
 * Hebrew alphabets and common punctuation, but not Chinese, Japanese, Korean
 * or emoji. A title is drawn only when every one of its characters is
 * covered (`fontsCover`); otherwise the picture carries no text (the title is
 * in the card's tags anyway) rather than boxes or a part of it.
 *
 * Text is laid out by Pango (sharp's `text` input), which applies the Unicode
 * bidirectional algorithm: a Hebrew title reads right to left, and is aligned
 * to the right (`isRightToLeft`).
 */

/**
 * The ranges the fonts surely cover, inclusive, as code points: letters and
 * common punctuation only. Kept narrow on purpose (symbol blocks are covered
 * only in part, and a missing glyph draws as a box): a title with anything
 * else is simply not drawn.
 */
const COVERED: ReadonlyArray<readonly [number, number]> = [
  [0x0020, 0x007e], // Basic Latin
  [0x00a0, 0x024f], // Latin-1 Supplement, Latin Extended-A and -B
  [0x0300, 0x036f], // Combining diacritical marks
  [0x0384, 0x03ce], // Greek letters and tonos
  [0x0400, 0x045f], // Cyrillic (Russian, Ukrainian, Serbian, Bulgarian…)
  [0x0490, 0x04ff], // Cyrillic extended letters
  [0x05b0, 0x05c7], // Hebrew points
  [0x05d0, 0x05ea], // Hebrew letters
  [0x05f0, 0x05f4], // Hebrew ligatures and punctuation
  [0x1e00, 0x1eff], // Latin Extended Additional (Vietnamese and others)
  [0x2010, 0x2027], // Dashes, quotes, bullets, ellipsis
  [0x200e, 0x200f], // Left-to-right and right-to-left marks
  [0x2030, 0x203a], // Per mille, primes, angle quotes
  [0x20ac, 0x20ac], // Euro sign
  [0x2122, 0x2122], // Trade mark sign
]

function covered(cp: number): boolean {
  for (const [lo, hi] of COVERED) if (cp >= lo && cp <= hi) return true
  return false
}

/** Whether the server's fonts can draw every character of `text`. */
export function fontsCover(text: string): boolean {
  for (const ch of text) {
    if (!covered(ch.codePointAt(0)!)) return false
  }
  return true
}

/** A title as the picture may draw it: spaces collapsed, at most `max` characters; null when the fonts cannot draw it. */
export function drawableTitle(title: string | null | undefined, max = 90): string | null {
  if (!title) return null
  const flat = title.replace(/\s+/g, " ").trim()
  if (!flat || !fontsCover(flat)) return null
  const chars = Array.from(flat)
  return chars.length <= max ? flat : `${chars.slice(0, max - 1).join("").trimEnd()}…`
}

/** Pango markup (and XML) escaping: the title is user text. */
export function escapeMarkup(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;")
}

/** Whether the text's first strong character is right to left (Hebrew): it is aligned to the right. */
export function isRightToLeft(text: string): boolean {
  for (const ch of text) {
    const cp = ch.codePointAt(0)!
    if ((cp >= 0x0590 && cp <= 0x05ff) || (cp >= 0xfb1d && cp <= 0xfb4f)) return true
    if (/\p{L}/u.test(ch)) return false
  }
  return false
}
