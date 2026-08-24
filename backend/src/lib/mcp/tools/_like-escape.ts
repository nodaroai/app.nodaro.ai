/**
 * Make a user-supplied string safe to drop inside a PostgREST `ilike` pattern.
 *
 * Two separate hazards, and both are easy to miss because neither raises:
 *
 *  - `%` and `_` are ILIKE wildcards. Unescaped, a search for `100%` quietly
 *    matches everything, and the caller reads it as "the tool is broken".
 *  - `,` `.` `(` `)` and `"` are PostgREST's own filter grammar. A name with a
 *    comma in it does not error — it changes which filters the request is
 *    parsed as having.
 *
 * The row set is already scoped by `user_id` in every caller, so the worst a
 * crafted string could do is widen the caller's search over their own data.
 * That is not a reason to leave the grammar to chance.
 */
const NEEDS_ESCAPE = /[%_\\]/g
const POSTGREST_PUNCTUATION = /[,.()"]/g

export function escapeLikeArgument(value: string): string {
  return value.replace(NEEDS_ESCAPE, (ch) => `\\${ch}`).replace(POSTGREST_PUNCTUATION, " ")
}
