/**
 * Word search, literal and case-insensitive: the one place the saved-entity
 * lists (characters, locations, objects, creatures, faces — `?q=`), the media
 * library (`?q=`, formerly `?search=`) and the MCP list and browse tools over
 * the same tables (`list_characters`, `list_locations`, `list_objects`,
 * `list_creatures`, `browse_uploads`, `browse_gallery`) turn search text into
 * a PostgREST filter, so those searches all mean the same thing.
 *
 * THE RULE is the one `q` already has on saved posts and collection records
 * (`searchWords` in routes/saved-posts.ts and lib/collections-store.ts): the
 * text is split on whitespace into at most five words, and a row is kept only
 * when EVERY word occurs in one of the searched columns, ignoring case — so
 * "red car" finds "Car, red". One difference, on purpose: those searches
 * remove punctuation before splitting, this one matches it as written inside a
 * word ("Smith," needs the comma; `%`, `_` and `*` match only themselves).
 * Blank text is no search, and text that could never be searched (over 200
 * characters, or a NUL, which Postgres text cannot hold) is refused HERE, so
 * no caller can send it to PostgREST.
 *
 * THE OPERATOR IS `imatch` (Postgres `~*`), NOT `ilike`. PostgREST rewrites
 * every `*` in a `like` / `ilike` value to `%` before the value reaches SQL
 * (`Query/SqlFragment.hs`: `star c = if c == '*' then '%' else c`), and no
 * escape survives that rewrite, so through `ilike` a search for "a*b" matches
 * "a…b". A regular expression gets no such rewrite, and with each
 * metacharacter escaped it is a literal. (Run against Postgres while this was
 * written, `~*` with these patterns agreed with a plain substring test on every
 * case — wildcards, punctuation, quotes, backslashes, Hebrew — and `ilike`
 * disagreed exactly on the `*` cases. The cost per row is the same order as
 * `ilike`'s. The community smoke probe runs it through a real PostgREST.)
 *
 * TWO LAYERS OF ESCAPING per word, applied in this order:
 *  1. The regex: a backslash before each of `\ ^ $ . | ? * + ( ) [ ] { }`. In
 *     Postgres's regex flavour a backslash before a non-alphanumeric character
 *     makes it an ordinary character. Nothing else needs one: `-`, `#` and `:`
 *     are ordinary outside a bracket expression, and an escaped `[` means
 *     there is never a bracket expression.
 *  2. PostgREST's `or=(…)` grammar: the value is double-quoted, and inside the
 *     quotes `\` and `"` take a backslash (`ApiRequest/QueryParams.hs`,
 *     `pQuotedValue`: a backslash means "take the next character as it is").
 *     Quoting is what lets a word carry `,` and `)`, which otherwise end a
 *     value (`pLogicSingleVal`), and keeps one starting with `{` from being
 *     read as an array.
 *
 * Each word is its own `.or()` (any column may hold it); separate `or`
 * parameters are ANDed by PostgREST — with each other, with a keyset cursor's
 * own `.or()` (see `keyset-cursor.ts`) and with every other filter.
 *
 * Columns are the caller's constants, never request input.
 */
import { z } from "zod"

/** The longest search text a list accepts, counted after trimming. */
export const SEARCH_TEXT_MAX_LENGTH = 200

/** How many words of a search are searched; any after them are ignored (the saved-posts rule). */
export const SEARCH_MAX_WORDS = 5

/**
 * What a search over saved characters, locations, objects, creatures and
 * faces looks at: the name, and the description the user wrote. Not the
 * generated caption (`canonical_description`): it is long and generic
 * ("a woman with red hair in soft light"), so a short search would match most
 * of the library and bury the name it was meant to find.
 */
export const SAVED_ENTITY_SEARCH_COLUMNS = ["name", "description"] as const

/** What a search over the media library looks at. */
export const ASSET_SEARCH_COLUMNS = ["filename"] as const

const REGEX_METACHARACTERS = /[\\^$.|?*+()[\]{}]/g
const QUOTED_VALUE_SPECIALS = /[\\"]/g

/** Search text that can never be searched: the reason, for a 400 or a tool error. */
export class SearchTextError extends Error {
  override readonly name = "SearchTextError"
}

/** Trimmed search text, or `undefined` when there is none (absent, empty or only whitespace). */
export function normalizeSearchText(raw: string | null | undefined): string | undefined {
  const text = raw?.trim()
  return text ? text : undefined
}

/**
 * Why `raw` can never be search text — more than {@link SEARCH_TEXT_MAX_LENGTH}
 * characters once trimmed, or a NUL — or `null` when it can. The one rule
 * behind both the routes' 400 ({@link searchTextParam}) and the refusal in
 * {@link textSearchFilters}.
 */
export function searchTextProblem(raw: string): string | null {
  if (raw.trim().length > SEARCH_TEXT_MAX_LENGTH) {
    return `Search text must be at most ${SEARCH_TEXT_MAX_LENGTH} characters`
  }
  if (raw.includes("\u0000")) return "Search text must not contain a NUL character"
  return null
}

/**
 * The words of a search: `raw` split on whitespace, the first
 * {@link SEARCH_MAX_WORDS}, punctuation kept. Blank text has none. Throws
 * {@link SearchTextError} for text that can never be searched.
 */
export function searchWords(raw: string | null | undefined): string[] {
  if (raw == null) return []
  const problem = searchTextProblem(raw)
  if (problem) throw new SearchTextError(problem)
  return raw
    .split(/\s+/)
    .filter((word) => word.length > 0)
    .slice(0, SEARCH_MAX_WORDS)
}

/**
 * A list route's search query parameter: trimmed, at most
 * {@link SEARCH_TEXT_MAX_LENGTH} characters, no NUL ({@link searchTextProblem}),
 * and blank means no search (`undefined`), never a 400.
 */
export const searchTextParam = z
  .string()
  .superRefine((raw, ctx) => {
    const problem = searchTextProblem(raw)
    if (problem) ctx.addIssue({ code: "custom", message: problem })
  })
  .transform((raw) => normalizeSearchText(raw))
  .optional()

/** A Postgres regular expression that matches `text` literally. */
export function literalRegex(text: string): string {
  return text.replace(REGEX_METACHARACTERS, "\\$&")
}

/**
 * One `.or()` argument per word of `raw` ({@link searchWords}), each keeping a
 * row when the word occurs, ignoring case, in any of `columns`; apply every one
 * (`for (const f of textSearchFilters(cols, q)) query = query.or(f)`) so a row
 * must hold all the words. Blank text gives none — no filter at all. Throws
 * {@link SearchTextError} for text that can never be searched, so it never
 * reaches PostgREST from any caller.
 */
export function textSearchFilters(columns: readonly string[], raw: string | null | undefined): string[] {
  if (columns.length === 0) throw new Error("textSearchFilters needs at least one column")
  return searchWords(raw).map((word) => {
    const value = `"${literalRegex(word).replace(QUOTED_VALUE_SPECIALS, "\\$&")}"`
    return columns.map((column) => `${column}.imatch.${value}`).join(",")
  })
}
