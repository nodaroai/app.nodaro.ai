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
 *  - `@kira:1:smile:face`   → variant smile, mode "face"
 *  - `@kira:1:smile:bogus`  → null (4-part rejected when last segment is not
 *                              a valid usage mode — keeps the format strict)
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
): { characterSlug: string; imageIndex: number; variantSlug: string | null; usageMode: UsageMode | null } | null {
  if (!text.startsWith("@")) return null
  const rest = text.slice(1)
  if (rest.length === 0 || !/^[a-z]/.test(rest)) return null

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
    return { characterSlug, imageIndex, variantSlug: null, usageMode: null }
  }

  // 3-part: kira:1:X — X is either a usage-mode keyword or a variant slug.
  // The closed `USAGE_MODES` enum + the variant-slug shape constraint
  // (`[a-z][a-z0-9-]*`) makes this unambiguous. A keyword like "face" wins
  // the mode interpretation; anything else is treated as a variant slug.
  if (parts.length === 3) {
    if (!/^[a-z][a-z0-9-]*$/.test(third)) return null
    if (isUsageMode(third)) {
      return { characterSlug, imageIndex, variantSlug: null, usageMode: third }
    }
    return { characterSlug, imageIndex, variantSlug: third, usageMode: null }
  }

  // 4-part: kira:1:smile:mode — variant + mode override. Both segments must
  // satisfy their respective shape; an unknown mode kills the token entirely
  // (callers fall back to literal text, matching unknown-character behavior).
  if (parts.length === 4) {
    if (!/^[a-z][a-z0-9-]*$/.test(third)) return null
    if (!isUsageMode(fourth)) return null
    return { characterSlug, imageIndex, variantSlug: third, usageMode: fourth }
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
  // disambiguates which segment is which based on `USAGE_MODES`.
  const regex = /(?:^|[^a-zA-Z0-9])(@[a-z][a-z0-9-]*:\d+(?::[a-z][a-z0-9-]*)?(?::[a-z][a-z0-9-]*)?)/g
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
