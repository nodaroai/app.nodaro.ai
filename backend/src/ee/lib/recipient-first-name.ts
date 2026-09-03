/**
 * The recipient's first name, in the shape Loops' `firstName` variable wants.
 *
 * ONE derivation, two callers — the marketing contact sync
 * (`consent-loops-sync.ts`) and the admin → user templates. They had drifted
 * into being the same three lines written twice, which is how "Hi there," in
 * one email and "Hi ," in another becomes possible.
 *
 * Splitting on whitespace is crude on purpose. "Ada Lovelace" → "Ada" is the
 * only transformation a greeting needs; a cleverer one (particles, honorifics,
 * mononyms, family-name-first orders) would get more names wrong than right,
 * and getting a name wrong in a support email is worse than not using one.
 */

/** The first whitespace-delimited token of a full name, or undefined. */
export function firstNameFrom(fullName: string | null | undefined): string | undefined {
  const first = (fullName ?? "").trim().split(/\s+/)[0]
  return first && first.length > 0 ? first : undefined
}

/**
 * What a TEMPLATE greets an unnamed recipient with.
 *
 * A word, never a blank: Loops rejects an empty data variable outright
 * ("Missing required data variable(s): firstName"), so "no name on file" has
 * to render as something. The templates read "Hi {firstName}," — this makes
 * that "Hi there,".
 */
export const GREETING_FALLBACK = "there"

/** The greeting name, guaranteed non-empty. */
export function greetingNameFrom(fullName: string | null | undefined): string {
  return firstNameFrom(fullName) ?? GREETING_FALLBACK
}
