/**
 * A caption line never starts or ends on a lone dash.
 *
 * A speech engine times a dash written between two spaces ("Nodaro — every model")
 * as a token of its own, and forced alignment keeps it. Inside a line the dash
 * reads as written; at a line's edge — the line breaks right after it, or the
 * next line opens with it — it reads as a stray mark. The display drops such a
 * token from the edge of the line it lands on; the words keep their own timings.
 *
 * One rule for every place that breaks captions into lines: the render's line
 * grouping (word-timed captions) and the wrap of a static text block.
 */

/** Dash characters only: hyphen-minus, the Unicode hyphens and dashes (U+2010–U+2015), minus, the Hebrew maqaf, and their small/full-width forms. */
const BARE_DASH = /^[-‐-―−־﹘﹣－]+$/u

/** True when the token, trimmed, is nothing but dash characters ("—", "–", "-"). A hyphenated word ("ה-AI", "re-run") is not. */
export function isBareDashToken(text: string): boolean {
  return BARE_DASH.test(text.trim())
}

/**
 * The items with every lone-dash token at either end removed (a copy; the input
 * is never mutated). A line holding nothing but dashes comes back empty — the
 * caller drops it rather than show it.
 */
export function trimEdgeDashTokens<T>(items: readonly T[], textOf: (item: T) => string): T[] {
  let start = 0
  let end = items.length
  while (start < end && isBareDashToken(textOf(items[start]!))) start++
  while (end > start && isBareDashToken(textOf(items[end - 1]!))) end--
  return items.slice(start, end)
}
