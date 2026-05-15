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
  readonly offset: number
}

/**
 * Parse a single `@<character>:<index>(:<variant>)?` token. The `:` separator
 * is the boundary between character slug, image index, and (optional) variant
 * slug — each side may contain internal dashes, so
 * `@young-kira:1:soft-smile` parses unambiguously as
 * `{ characterSlug: "young-kira", imageIndex: 1, variantSlug: "soft-smile" }`.
 *
 * Format change: as of the index-in-slug update, the index segment is
 * required. Bare `@kira` is no longer a valid mention token; the autocomplete
 * always inserts at least `@kira:N` where N is the next available index in
 * the prompt. This keeps the user-typed slug and the final identity directive
 * in lock-step.
 *
 * `knownCharacterSlugs` is no longer needed for parsing (the structure is
 * unambiguous) — it remains accepted for API compatibility but ignored here.
 * `findCharacterMentionTokens` still uses it to filter unknown characters.
 */
export function parseCharacterMentionToken(
  text: string,
  _knownCharacterSlugs?: readonly string[],
): { characterSlug: string; imageIndex: number; variantSlug: string | null } | null {
  if (!text.startsWith("@")) return null
  const rest = text.slice(1)
  if (rest.length === 0 || !/^[a-z]/.test(rest)) return null

  // Format: <character>:<index> or <character>:<index>:<variant>.
  // Splitting on ":" requires at least 2 parts (no bare @character anymore).
  const parts = rest.split(":")
  if (parts.length < 2 || parts.length > 3) return null

  const [characterSlug, indexStr, variantSlug] = parts
  if (!/^[a-z][a-z0-9-]*$/.test(characterSlug)) return null
  if (!/^\d+$/.test(indexStr)) return null
  const imageIndex = parseInt(indexStr, 10)
  if (!Number.isInteger(imageIndex) || imageIndex < 1) return null
  if (variantSlug !== undefined && !/^[a-z][a-z0-9-]*$/.test(variantSlug)) {
    return null
  }
  return {
    characterSlug,
    imageIndex,
    variantSlug: variantSlug ?? null,
  }
}

/** Find all @-mentions in a prompt that match a known character slug. */
export function findCharacterMentionTokens(
  prompt: string,
  knownCharacterSlugs: readonly string[],
): CharacterMentionTokenInfo[] {
  const tokens: CharacterMentionTokenInfo[] = []
  // `@<character>:<index>(:<variant>)?` preceded by non-alphanumeric (or
  // start of string) to prevent email-like matches. The `\d+` index segment
  // is required — see `parseCharacterMentionToken` for the rationale.
  const regex = /(?:^|[^a-zA-Z0-9])(@[a-z][a-z0-9-]*:\d+(?::[a-z][a-z0-9-]*)?)/g
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
