/**
 * The SHORT `@-mention` grammar core — `@<name-slug>:<index>[:<role>][~lock|~nolock]`.
 *
 * ONE parser, ONE finder, ONE pair of collision guards, shared by every mention
 * kind whose token has NO variant/bucket slot:
 *
 *   - `image-mention-slug.ts`  — wired media (`wired-image` / `manual`)
 *   - `entity-mention-slug.ts` — wired entities (`wired-creature` / `wired-object`)
 *
 * WHY EXTRACTED (and why the 5-line slugify precedent does NOT apply here). The
 * character/location/image modules each keep their own copy of the trivial
 * `characterMentionSlug` algorithm — duplication that is cheap because the
 * function is five obvious lines. What is shared HERE is the opposite: the
 * two-part collision guard (`(?![:a-z0-9-])`, which stops a 4-part CHARACTER
 * token being claimed as a 3-part one, and the post-match slash guard, which
 * stops a LOCATION bucket token being spliced as its own truncated prefix).
 * Those guards exist precisely to prevent prompt corruption, and a second
 * hand-copied edition of them is a drift surface with a corruption payload. So
 * the media and entity grammars converge on this module and the per-kind files
 * keep only what genuinely differs: WHICH refs contribute a slug.
 *
 * The character and location grammars do NOT use this core — their tokens carry
 * 2–4 segments with a variant/bucket/usage-mode slot, a materially different
 * shape, and their finders deliberately have NO trailing-reject lookahead.
 */

/**
 * Grammar-valid slug shape — the exact shape `findMentionTokens`' regex can
 * produce, and therefore the gate on BOTH sides of the match.
 *
 * Emptiness is NOT the gate: `mentionNameSlug("3D Render")` → `"3d-render"` is
 * non-empty yet UNPARSEABLE (a leading digit), so a ref named "3D Render" must
 * be dropped from a known-slug set even though its slug is truthy. This pattern
 * is what drops it.
 */
export const MENTION_SLUG_PATTERN = /^[a-z][a-z0-9-]*$/

/**
 * Slugify a reference's display name for `@`-mention tokens. Byte-identical
 * algorithm to `characterMentionSlug` / `locationMentionSlug`; the per-kind
 * modules re-export it under their own name so each call site's intent stays
 * explicit.
 */
export function mentionNameSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
}

/** Kind-neutral parse result. The per-kind modules rename `slug` / `index`. */
export interface ParsedMentionToken {
  readonly slug: string
  readonly index: number
  /** Present ONLY for a 3-part token; omitted otherwise (shape rule). */
  readonly role?: string
  /** Present ONLY when a sentinel was found; omitted otherwise (shape rule). */
  readonly lock?: boolean
}

/** Kind-neutral finder result — a `ParsedMentionToken` plus its splice site. */
export interface FoundMentionToken extends ParsedMentionToken {
  /** The matched token text, verbatim — spliced out of the prompt at resolve time. */
  readonly token: string
  /** Byte offset into the source prompt — used to splice the token out. */
  readonly offset: number
}

/**
 * Parse a single `@<name-slug>:<index>[:<role>]` token. Returns null when the
 * token doesn't match a supported shape (the caller falls back to literal text).
 *
 * Segment count is 2 or 3 — NOT 2–4 like the character/location parsers. Neither
 * a media reference nor a wired entity has a variant/bucket slot, so there is
 * nothing for a 4th segment to mean, and claiming one would let this parser
 * swallow a character token.
 */
export function parseMentionToken(text: string): ParsedMentionToken | null {
  if (!text.startsWith("@")) return null
  let rest = text.slice(1)
  if (rest.length === 0 || !/^[a-z]/.test(rest)) return null

  // Strip a trailing `~nolock` (force OFF) or `~lock` (force ON) BEFORE splitting
  // so the segment grammar is untouched (a `~` never appears inside a segment).
  // Check `~nolock` FIRST — `~lock` is its suffix. A token with NEITHER sentinel
  // gains NO `lock` key.
  let lockField: { lock?: boolean } = {}
  if (rest.endsWith("~nolock")) {
    rest = rest.slice(0, -"~nolock".length)
    lockField = { lock: false }
  } else if (rest.endsWith("~lock")) {
    rest = rest.slice(0, -"~lock".length)
    lockField = { lock: true }
  }

  const parts = rest.split(":")
  if (parts.length < 2 || parts.length > 3) return null

  const [slug, indexStr, third] = parts
  if (!MENTION_SLUG_PATTERN.test(slug)) return null
  if (!/^\d+$/.test(indexStr)) return null
  const index = parseInt(indexStr, 10)
  if (!Number.isInteger(index) || index < 1) return null

  if (parts.length === 2) return { slug, index, ...lockField }
  if (!MENTION_SLUG_PATTERN.test(third)) return null
  return { slug, index, role: third, ...lockField }
}

// ONE optional segment (the role) — media refs and wired entities have no
// variant/bucket slot.
//
// The trailing `(?![:a-z0-9-])` is the DELIBERATE divergence from the character
// and location finders. Without it, a 4-part CHARACTER token that the character
// pass failed to resolve (`@kira:1:smile:face`) would be captured here as the
// 3-part `@kira:1:smile`, leaving `:face` dangling in the prompt. The lookahead
// makes the regex backtrack and match nothing, so a 4-part token is NEVER a
// short-grammar mention. `~lock` still matches (`~` is outside the class), and
// its own `(?![a-z0-9-])` keeps `~locked` / `~nolockx` literal.
//
// Linear-scan shape (a fixed prefix then bounded optional groups, no nested
// quantifiers) — matching the sibling finders, and ReDoS-free.
const MENTION_TOKEN_REGEX =
  /(?:^|[^a-zA-Z0-9])(@[a-z][a-z0-9-]*:\d+(?::[a-z][a-z0-9-]*)?(?:~(?:no)?lock(?![a-z0-9-]))?)(?![:a-z0-9-])/g

/**
 * Find every short-grammar `@-mention` in a prompt whose slug is in
 * `knownSlugs`.
 *
 * `knownSlugs` is what keeps one kind's parser off another kind's tokens — every
 * finder matches the same `@slug:N…` surface and only the known-slug set
 * separates them.
 */
export function findMentionTokens(
  prompt: string,
  knownSlugs: readonly string[],
): FoundMentionToken[] {
  const tokens: FoundMentionToken[] = []
  // A module-level `g` regex carries `lastIndex` state; `matchAll` requires the
  // `g` flag but resets nothing, so re-create the scanner per call.
  const regex = new RegExp(MENTION_TOKEN_REGEX.source, "g")
  const knownSet = new Set(knownSlugs)
  for (const match of prompt.matchAll(regex)) {
    const token = match[1]
    const offset = (match.index ?? 0) + (match[0].length - token.length)
    // SLASH GUARD — the second half of the collision guard, and the reason it
    // is a post-match check instead of another lookahead in the regex. `/` is
    // the LOCATION grammar's bucket/variant separator (`@lib:1:weather/rain`),
    // so a token immediately followed by `/<segment>` is a sibling-grammar
    // token, never a short-grammar mention. A lookahead cannot express this:
    // the engine would just BACKTRACK to a shorter prefix (`@lib:1:weather` →
    // `@lib:1`, or `@town:1~lock` → `@town:1`) and splice THAT, which is the
    // very corruption being prevented. Rejecting the whole match here leaves
    // the token literal, exactly as the character/location finders do.
    //
    // `/` alone is NOT the signal — `@town:1/@barn:2` (two mentions separated
    // by a slash) must keep matching, and a location segment always starts
    // `[a-z]`. So the guard is `/` + a segment start.
    if (/^\/[a-z]/.test(prompt.slice(offset + token.length))) continue
    const parsed = parseMentionToken(token)
    if (parsed && knownSet.has(parsed.slug)) {
      tokens.push({ token, ...parsed, offset })
    }
  }
  return tokens
}
