/**
 * WHERE a price figure sits in a page: the `<!-- credits…: … -->` annotation
 * and the number it binds to. One definition for both of its readers:
 *
 *  - the docs price check (`scripts/lib/docs-prices.ts`, which owns the
 *    annotation's expression syntax and prices it), and
 *  - the MCP document funnel (`lib/mcp/served-documents.ts`), which states a
 *    served skill's figures in a deployment's own unit at serving time.
 *
 * The comment binds to the number right before it: a "credits" / "CR" word, a
 * `/unit` suffix and `**` may sit between them (`11 credits**<!-- credits: x -->`,
 * `1.1<!-- credits-rate: y --> credits`, `495<!-- credits: z -->cr/block`).
 *
 * Pure text, no imports: core code on every edition.
 */

/** An annotation: group 1 is `-rate` / `-llm-rate` / undefined, group 2 its expression. Use with `matchAll` only. */
export const PRICE_ANNOTATION = /<!--\s*credits(-rate|-llm-rate)?:\s*(.*?)\s*-->/g

/** Which comment an annotation is written in: `credits:`, `credits-rate:` or `credits-llm-rate:`. */
export type AnnotationComment = "charge" | "rate" | "llm-rate"

/** The comment kind of a `PRICE_ANNOTATION` match's first group. */
export function annotationCommentOf(group: string | undefined): AnnotationComment {
  return group === "-rate" ? "rate" : group === "-llm-rate" ? "llm-rate" : "charge"
}

/** The number an annotation binds to: its value, where it starts and ends in the line, and how it is written. */
export interface BoundFigure {
  value: number
  start: number
  end: number
  text: string
}

/** The number right before `end` in `line`, past a credits word, a /unit suffix and `**`. */
export function figureBefore(line: string, end: number): BoundFigure | null {
  const before = line.slice(0, end).replace(/(?:\*\*|\s|-?credits?(?:\/[a-z]+)?|-?\bCR\b)*$/i, "")
  const m = before.match(/(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)$/)
  if (!m) return null
  return { value: Number(m[1]!.replace(/,/g, "")), start: before.length - m[1]!.length, end: before.length, text: m[1]! }
}
