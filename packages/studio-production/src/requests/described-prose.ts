/**
 * THE DESCRIBED ROLE'S NAME, PUT BACK INTO THE PROSE (spec
 * `2026-09-06-reference-menu-and-described-roles-design`, R7).
 *
 * A described role is a cast row with words and no face: it attaches no
 * picture, claims no `@image_N` seat, and rides its own wire channel where the
 * route correlates it with the prompt **by name** — `describedReferences: [{
 * name: "Natalie", description: … }]` beside a sentence that has to say
 * "Natalie". A cast chip serializes into the persisted prose as its role token
 * (`@natalie`, CLAUDE.md / C6), so without this pass the wire says `@natalie`
 * about someone the model was told is `Natalie`: the platform's mention grammar
 * addresses only `@slug:N`, so the bare token matches nothing and rides
 * literally to the model beside an identity line that names nobody.
 *
 * WHY IT LIVES HERE, BESIDE THE BUILDERS, AND NOT IN THE CODEC.
 * In the studio app this is the third argument of `bindMentionTokens` /
 * `bindReferenceTokens`, threaded through `role-prose.ts`'s
 * `untokenizeRoleReferences(text, references, described)` — and the codec
 * snapshot this package carries predates R7: `prompt-mentions.ts`,
 * `role-prose.ts` and `directing-references.ts` moved as their two-argument
 * selves and `prose-described.ts` did not move at all. Closing that is a CODEC
 * port (P0.2), owned elsewhere. Until it lands, the builders apply this pass to
 * the binder's OUTPUT, which is exactly equivalent: in every one of the studio
 * binders' return paths the described pass is the LAST thing that touches the
 * prose, the chip pass has already run (first-name-wins is settled), a bound
 * `@kira:1` is protected by the same {@link TOKEN_TRAILING} guard, and a
 * `{ref:<id>}` carries no `@` for the walk to find.
 *
 * TODO(codec): fold into `role-prose.ts` as `untokenizeRoleReferences`' third
 * parameter when the P0.2 port lands, and delete this module — the builders'
 * call sites become the studio's own.
 */
import type { DescribedReference } from "@nodaro/shared"

import { castKeyForName } from "../cast-keys"
import { castMentionRuns, isNameChar } from "../cast-mention-runs"
import { TOKEN_TRAILING } from "../mention-grammar"
import { untokenizeRoles } from "../role-prose"

/** A word character for boundary purposes — a mention ends where prose resumes.
 *  (`mention-grammar.ts` in the studio app; not in this package's copy yet.) */
function isWordChar(ch: string | undefined): boolean {
  return ch !== undefined && /[\p{L}\p{N}]/u.test(ch)
}

/**
 * Does a typed `@Name` end at `index`? Word characters end it for the obvious
 * reason ("@Eitan" must not match an entity called "Eit"), and so does a `-`
 * that CONTINUES the run: post-C6 a suffixed role serializes as `@panda-2`, and
 * `-` is not a word character, so a library "Panda" used to bind inside it and
 * recover the WRONG actor. The `-2` suffix is minted precisely when a "Panda"
 * already exists, so that collision is the norm wherever a suffixed role does.
 * A trailing `:` still ends the name — `@kira:1` is the wire's own spelling of
 * Kira — and {@link TOKEN_TRAILING} is what the READERS then use to leave that
 * bound token alone.
 */
function endsTypedName(text: string, index: number): boolean {
  const next = text[index]
  if (next === undefined) return true
  if (isWordChar(next)) return false
  return !(next === "-" && isWordChar(text[index + 1]))
}

/** A cast key index — anything that answers "is this a role?" and can list the
 *  keys it holds. A `Map` and a `Set` both satisfy it structurally. */
export interface CastKeyIndex {
  has(key: string): boolean
  keys(): Iterable<string>
}

/** One name the prose claims: the `@`'s index, the index one past the name's
 *  last character, and the KEY it addresses. */
export interface CastNameClaim {
  readonly start: number
  readonly end: number
  readonly key: string
}

/**
 * The key claiming the run at `at`, or null. The walk reads the scanner's own
 * alphabet ({@link isNameChar}) — except that the gap between two words is
 * walked as a RUN: the run scanner stops at a double space, and a name an author
 * spaced twice is the very spelling that hands the enrollment ladder a bare
 * first word. Every index the BINDER would accept as the end of a typed name is
 * offered — a word character before it ({@link isWordChar}: a name ending
 * anywhere else would eat punctuation the PROSE owns, and `@Zoo Elephants'
 * enclosure` is the elephants plus a possessive), {@link endsTypedName} after
 * it, which is what lets a name end at a possessive (`@Young Man in Red
 * Jacket's hand`) and not only at a space — and the LONGEST match wins, so a
 * longer name beats a shorter one that is its prefix.
 *
 * The walk stops once the key outgrows the longest one held: extending the
 * slice can only grow its key, so nothing further can match, and a long passage
 * is never keyed word by word to the end of the sentence.
 */
function claimAt(
  text: string,
  at: number,
  keys: CastKeyIndex,
  longestKey: number,
): CastNameClaim | null {
  const from = at + 1
  let claim: CastNameClaim | null = null
  for (let end = from + 1; end <= text.length; end += 1) {
    const last = text[end - 1]!
    if (!isNameChar(last)) break
    if (!isWordChar(last) || !endsTypedName(text, end)) continue
    const key = castKeyForName(text.slice(from, end))
    if (key.length > longestKey) break
    if (keys.has(key)) claim = { start: at, end, key }
  }
  return claim
}

/**
 * Every name in `text` that `keys` accounts for, in order, non-overlapping —
 * THE ONE WALK for a reader that meets a cast name as raw text.
 *
 * BOTH SPELLINGS fall out of it rather than being cased on: `castKeyForName`
 * collapses a display name and its token onto one key, so `@Teodora Lisle` and
 * `@teodora-lisle` are the same claim.
 *
 * A run whose claim was already consumed by an earlier one is skipped
 * (`start < cursor`), so a name inside a name is never claimed twice.
 */
export function castNameClaims(
  text: string,
  keys: CastKeyIndex,
): CastNameClaim[] {
  let longestKey = 0
  for (const key of keys.keys()) longestKey = Math.max(longestKey, key.length)
  const out: CastNameClaim[] = []
  let cursor = 0
  for (const { start } of castMentionRuns(text)) {
    if (start < cursor) continue
    const claim = claimAt(text, start, keys, longestKey)
    if (!claim) continue
    out.push(claim)
    cursor = claim.end
  }
  return out
}

/**
 * The DESCRIBED role's OTHER spelling: `@Teodora Lisle` → `Teodora Lisle`.
 *
 * {@link untokenizeRoles} knows only the `@<role-slug>` token, which is what a
 * CHIP serializes as. The scene's generic prompt is a plain textarea, so the
 * name there is whatever was written — it can be the display form, and a
 * `@Name` the described channel is telling the model about is the same broken
 * sentence a raw `@name-slug` is.
 *
 * DESCRIBED NAMES ONLY. A bound chip's name is deliberately not read here: its
 * mention keeps the path the binders already give it, and the bound wire stays
 * byte-identical.
 *
 * IT IS THE WALK, not a pattern that mirrors it — the walk CLAIMS every
 * spelling that slugs to the role's key (`@O'Brien` for "O'Brien",
 * `@Zoo-Elephants` for "Zoo Elephants", `@Dr Lisle` for "Dr. Lisle"), and each
 * one a mirror missed put a raw `@` in front of the very name the described
 * channel was telling the model about.
 *
 * {@link TOKEN_TRAILING} then has the last word, exactly as it does for the
 * token pass: a claim the WIRE's own grammar continues is a longer, different
 * token, so a described "Jack" beside a BOUND `@jack:1` leaves that mention
 * untouched rather than degrading it to `Jack:1`.
 */
function untokenizeDescribedNames(
  text: string,
  described: ReadonlyArray<DescribedReference> | undefined,
): string {
  if (!text.includes("@") || !described?.length) return text
  // The role's own casing is what lands — the key folds case and collapses
  // gaps, so every spelling of one name resolves to the one word to write.
  const byKey = new Map<string, string>()
  for (const d of described) {
    const name = d.name.trim()
    if (!name) continue
    const key = castKeyForName(name)
    if (key && !byKey.has(key)) byKey.set(key, name)
  }
  if (byKey.size === 0) return text
  let out = ""
  let cursor = 0
  for (const { start, end, key } of castNameClaims(text, byKey)) {
    if (TOKEN_TRAILING.test(text[end] ?? "")) continue
    out += text.slice(cursor, start) + byKey.get(key)!
    cursor = end
  }
  // The SAME string when nothing was claimed — the common path allocates
  // nothing, like the token pass.
  return cursor === 0 ? text : out + text.slice(cursor)
}

/**
 * Give every described role in `text` its human word back — the pass a builder
 * applies to the wire prose after the chip binder has had its turn.
 *
 * BOTH spellings, in the studio's own order: the `@<role-slug>` token first
 * ({@link untokenizeRoles}, keyed by the described names), then the display form
 * ({@link untokenizeDescribedNames}). A WORDLESS role is named too — the wire
 * DROPS it (there is nothing to say), and its token would otherwise ride raw,
 * which is why the builders hand this the UNFILTERED list and filter only the
 * channel.
 *
 * Returns the SAME string when there is nothing to name.
 */
export function nameDescribedRoles(
  text: string,
  described: ReadonlyArray<DescribedReference> | undefined,
): string {
  if (!described?.length) return text
  const named = untokenizeRoles(
    text,
    described.map((d) => d.name),
  )
  return untokenizeDescribedNames(named, described)
}
