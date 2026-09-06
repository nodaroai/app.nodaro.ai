import { castKeyForName, roleTokenForName } from "../cast"
import { castMentionRuns, isNameChar } from "../cast-mention-runs"
import { endsTypedName, isWordChar } from "../prompt-mentions"

import { mapBindablePassages } from "./import-passages"
import type { CastEntry, ProductionDocument } from "./schema"

/**
 * CANONICALIZE (D41) — the half-stage in front of RESOLVE that rewrites every
 * `@Declared Name` into the name's own role TOKEN (`@young-man-in-red-jacket`).
 *
 * The token form is the CANONICAL persisted spelling of a cast mention (C6 —
 * "the prose IS the grammar"); `@Name` is merely accepted on input, and this is
 * where it is normalized, so the mapped shots, the preview and the landed prose
 * all say the same thing the editor would have written.
 *
 * Why it has to happen BEFORE the library is consulted: a mention is a greedy
 * run of words and the binder takes the longest LIBRARY spelling that ends at a
 * name boundary, so a library "young" bound the head of `@Young Man in Red
 * Jacket` and left " Man in Red Jacket" as prose (staging, 2026-09-04) — and
 * the editor's own restore sweep repeats the capture, which is why fixing the
 * binder alone would not have been enough. As a token the name is ONE
 * hyphenated word to every reader of `@`: no shorter library name can end
 * inside it (a `-` continues the run), the enrollment ladder can never split
 * it, and the moment the entity exists the token binds WHOLE.
 *
 * Only DECLARED names move. An `@` run naming nobody in `cast` keeps its prefix
 * ladder — an undeclared `@Old Library Annex` still binds a library
 * "Old Library" — and a declared name with no role token to wear (a slug that
 * can't address anything) is left exactly as written.
 */
export function canonicalizeDeclaredMentions(doc: ProductionDocument): ProductionDocument {
  const tokens = declaredTokens(doc.cast)
  if (tokens.size === 0) return doc
  return mapBindablePassages(doc, (text) => canonicalizeProse(text, tokens))
}

/** The role token each declared name wears, by the KEY that name addresses —
 *  the identity two spellings of one name share (`castKeyForName` lower-cases
 *  and collapses every gap, so "Young  Man" and "young man" arrive as one).
 *  A name with no token can't be canonicalized and is simply absent here. */
function declaredTokens(
  cast: ReadonlyArray<CastEntry> | undefined,
): ReadonlyMap<string, string> {
  const out = new Map<string, string>()
  for (const entry of cast ?? []) {
    const name = entry.name.trim()
    const token = roleTokenForName(name)
    if (token) out.set(castKeyForName(name), token)
  }
  return out
}

/** The declared name claiming the run at `at`, or null. The walk reads the
 *  scanner's own alphabet ({@link isNameChar}) — except that the gap between two
 *  words is walked as a RUN: the run scanner stops at a double space, and a name
 *  an author spaced twice is the very spelling that hands the enrollment ladder
 *  a bare first word. Every index the BINDER would accept as the end of a typed
 *  name is offered — a word character before it ({@link isWordChar}: a name
 *  ending anywhere else would eat punctuation the PROSE owns, and `@Zoo
 *  Elephants' enclosure` is the elephants plus a possessive), {@link
 *  endsTypedName} after it, which is what lets a name end at a possessive
 *  (`@Young Man in Red Jacket's hand`) and not only at a space — and the LONGEST
 *  match wins, so a longer declared name beats a shorter one that is its prefix
 *  ("Zoo" and "Zoo Elephants", both declared).
 *
 *  The walk stops once the key outgrows the longest declared one: extending the
 *  slice can only grow its key, so nothing further can match, and a long
 *  passage is never keyed word by word to the end of the sentence. */
function claimDeclared(
  text: string,
  at: number,
  tokens: ReadonlyMap<string, string>,
  longestKey: number,
): { end: number; token: string } | null {
  const from = at + 1
  let claim: { end: number; token: string } | null = null
  for (let end = from + 1; end <= text.length; end += 1) {
    const last = text[end - 1]!
    if (!isNameChar(last)) break
    if (!isWordChar(last) || !endsTypedName(text, end)) continue
    const key = castKeyForName(text.slice(from, end))
    if (key.length > longestKey) break
    const token = tokens.get(key)
    if (token) claim = { end, token }
  }
  return claim
}

/** One passage with its declared mentions canonicalized — the SAME string when
 *  none of them are here (the common case, and what keeps the document itself
 *  copy-on-write). */
function canonicalizeProse(text: string, tokens: ReadonlyMap<string, string>): string {
  let longestKey = 0
  for (const key of tokens.keys()) longestKey = Math.max(longestKey, key.length)
  let out = ""
  let cursor = 0
  for (const { start } of castMentionRuns(text)) {
    if (start < cursor) continue
    const claim = claimDeclared(text, start, tokens, longestKey)
    if (!claim) continue
    out += text.slice(cursor, start) + claim.token
    cursor = claim.end
  }
  return cursor === 0 ? text : out + text.slice(cursor)
}
