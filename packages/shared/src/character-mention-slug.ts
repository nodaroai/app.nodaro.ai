import { isUsageMode, type UsageMode } from "./character-usage-mode.js"

/**
 * Slugify a name (character or variant) for use in @-mention tokens.
 * Lowercase, strip non-alphanumeric, collapse runs of dashes.
 */
export function characterMentionSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
}

export interface CharacterMentionTokenInfo {
  readonly token: string
  readonly characterSlug: string
  /**
   * 1-based positional index assigned at insertion time by the autocomplete.
   * Lets the user wire a literal-text mention (`@kira:1`) to a final-prompt
   * identity directive (`Image 1 (person) — match exactly…`) so the order in
   * the typed prompt matches the order in the assembled directive block.
   */
  readonly imageIndex: number
  readonly variantSlug: string | null
  /**
   * Optional per-mention usage-mode override (e.g. `:face`, `:style`). When
   * `null`, the assembled directive falls back to the source character node's
   * `defaultUsageMode`, then to the global `"identical"` default. Always one
   * of the entries in `USAGE_MODES` when non-null — the parser rejects any
   * other 4-part token.
   */
  readonly usageMode: UsageMode | null
  /**
   * Per-mention ROLE from a NON-MODE 4th segment (Variant + Role Separation) —
   * coexists with a real variant: the variant picks the IMAGE, the role picks
   * the PHRASE (`@kira:1:walking:clothes` → walking image, "the clothes from
   * …"). Curated or custom slug, stored verbatim. OMITTED (undefined, not
   * null) for every other shape — 2/3-part tokens and mode-bearing 4-part
   * tokens keep their pre-existing parse byte-identically. Mirrors
   * `LocationMentionTokenInfo.role`.
   */
  readonly role?: string
  /**
   * Additive per-mention identity-lock sentinel (Unified Reference Roles,
   * Task 4 + F4). Tri-state: `true` (trailing `~lock`, force lock ON) |
   * `false` (trailing `~nolock`, force lock OFF — suppresses a ref-level
   * `identityLock.enabled = true`) | ABSENT/undefined (neither sentinel —
   * inherit the ref/source default; byte-identical to the pre-Task-4 shape).
   * Only ACTED UPON by the HYBRID resolvers; the LEGACY resolvers ignore it
   * entirely, so both `~lock` and `~nolock` are inert on the legacy path.
   */
  readonly lock?: boolean
  readonly offset: number
}

/**
 * Parse a single `@<character>:<index>(:<variant>)?(:<usageMode>)?` token.
 *
 * Supported shapes (each segment after `:` may contain internal dashes, so
 * `@young-kira:1:soft-smile` parses unambiguously as character + index +
 * variant):
 *
 *  - `@kira:1`              → canonical, default mode
 *  - `@kira:1:smile`        → variant smile, default mode
 *  - `@kira:1:face`         → canonical, mode "face"  (mode is detected by
 *                              checking the 3rd segment against `USAGE_MODES`)
 *  - `@kira:1:smile:face`    → variant smile, mode "face"
 *  - `@kira:1:walking:clothes` → variant walking, ROLE "clothes" (Variant +
 *                              Role Separation: a non-mode 4th segment is a
 *                              per-mention role — curated or custom — that
 *                              coexists with the variant)
 *
 * Format change: as of the index-in-slug update, the index segment is required.
 * Bare `@kira` is not a mention; the autocomplete always inserts at least
 * `@kira:N`.
 *
 * `knownCharacterSlugs` is no longer needed for parsing (the structure is
 * unambiguous given the closed `USAGE_MODES` enum) — it remains accepted for
 * API compatibility but ignored here. `findCharacterMentionTokens` still uses
 * it to filter unknown characters.
 */
export function parseCharacterMentionToken(
  text: string,
  _knownCharacterSlugs?: readonly string[],
): { characterSlug: string; imageIndex: number; variantSlug: string | null; usageMode: UsageMode | null; role?: string; lock?: boolean } | null {
  if (!text.startsWith("@")) return null
  let rest = text.slice(1)
  if (rest.length === 0 || !/^[a-z]/.test(rest)) return null

  // Additive `~lock` / `~nolock` sentinels (Unified Reference Roles, Task 4 +
  // F4). Strip a trailing `~nolock` (force lock OFF) or `~lock` (force lock ON)
  // BEFORE splitting on ":" so the segment grammar below is byte-identical to
  // pre-Task-4 (a `~` can never appear inside a segment — the shapes are
  // `[a-z][a-z0-9-]*`). Check `~nolock` FIRST: `"x~nolock".endsWith("~lock")` is
  // false (last 5 chars "olock"), but the explicit ordering keeps intent clear.
  // A token with NEITHER sentinel is untouched here and gains NO `lock` key
  // (byte-identical). The parsed tri-state `lock` (true/false/undefined) is only
  // honored by the HYBRID resolvers — undefined inherits the ref default, true
  // forces the lock on, false forces it off.
  let lockField: { lock?: boolean } = {}
  if (rest.endsWith("~nolock")) {
    rest = rest.slice(0, -"~nolock".length)
    lockField = { lock: false }
  } else if (rest.endsWith("~lock")) {
    rest = rest.slice(0, -"~lock".length)
    lockField = { lock: true }
  }

  // Format: <character>:<index>(:<variant|mode>)?(:<mode>)?.
  // Splitting on ":" requires 2–4 parts (no bare @character anymore).
  const parts = rest.split(":")
  if (parts.length < 2 || parts.length > 4) return null

  const [characterSlug, indexStr, third, fourth] = parts
  if (!/^[a-z][a-z0-9-]*$/.test(characterSlug)) return null
  if (!/^\d+$/.test(indexStr)) return null
  const imageIndex = parseInt(indexStr, 10)
  if (!Number.isInteger(imageIndex) || imageIndex < 1) return null

  // 2-part: kira:1 — canonical, default mode.
  if (parts.length === 2) {
    return { characterSlug, imageIndex, variantSlug: null, usageMode: null, ...lockField }
  }

  // 3-part: kira:1:X — X is either a usage-mode keyword or a variant slug.
  // The closed `USAGE_MODES` enum + the variant-slug shape constraint
  // (`[a-z][a-z0-9-]*`) makes this unambiguous. A keyword like "face" wins
  // the mode interpretation; anything else is treated as a variant slug.
  if (parts.length === 3) {
    if (!/^[a-z][a-z0-9-]*$/.test(third)) return null
    if (isUsageMode(third)) {
      return { characterSlug, imageIndex, variantSlug: null, usageMode: third, ...lockField }
    }
    return { characterSlug, imageIndex, variantSlug: third, usageMode: null, ...lockField }
  }

  // 4-part: kira:1:variant:X — variant + a 4th segment that is EITHER a
  // usage-mode override (today's shape, routed to `usageMode` byte-identically)
  // OR — Variant + Role Separation — any other slug, parsed as a per-mention
  // ROLE that coexists with the variant (the variant picks the image, the role
  // picks the phrase). The `role` key is emitted ONLY on the non-mode branch so
  // mode-bearing tokens keep their exact pre-existing shape.
  if (parts.length === 4) {
    if (!/^[a-z][a-z0-9-]*$/.test(third)) return null
    if (!/^[a-z][a-z0-9-]*$/.test(fourth)) return null
    if (isUsageMode(fourth)) {
      return { characterSlug, imageIndex, variantSlug: third, usageMode: fourth, ...lockField }
    }
    return { characterSlug, imageIndex, variantSlug: third, usageMode: null, role: fourth, ...lockField }
  }

  return null
}

/** Find all @-mentions in a prompt that match a known character slug. */
export function findCharacterMentionTokens(
  prompt: string,
  knownCharacterSlugs: readonly string[],
): CharacterMentionTokenInfo[] {
  const tokens: CharacterMentionTokenInfo[] = []
  // `@<character>:<index>(:<variant|mode>)?(:<mode>)?` preceded by
  // non-alphanumeric (or start of string) to prevent email-like matches.
  // The `\d+` index segment is required — see `parseCharacterMentionToken`
  // for the rationale. The two optional trailing `:<slug>` groups absorb
  // either `:<variant>`, `:<mode>`, or `:<variant>:<mode>`; the parser
  // disambiguates which segment is which based on `USAGE_MODES`. The optional
  // trailing `(?:~(?:no)?lock)?` absorbs the additive Task-4/F4 identity-lock
  // sentinel (`~lock` force-on OR `~nolock` force-off) INTO the token (so it is
  // spliced out at resolve time); it is optional, so a lock-less token matches
  // byte-identically to before. The `(?![a-z0-9-])` word boundary keeps
  // `~locked` / `~nolockx` literal.
  const regex = /(?:^|[^a-zA-Z0-9])(@[a-z][a-z0-9-]*:\d+(?::[a-z][a-z0-9-]*)?(?::[a-z][a-z0-9-]*)?(?:~(?:no)?lock(?![a-z0-9-]))?)/g
  const knownSet = new Set(knownCharacterSlugs)
  for (const match of prompt.matchAll(regex)) {
    const token = match[1]
    const offset = (match.index ?? 0) + (match[0].length - token.length)
    const parsed = parseCharacterMentionToken(token)
    if (parsed && knownSet.has(parsed.characterSlug)) {
      tokens.push({ token, ...parsed, offset })
    }
  }
  return tokens
}
