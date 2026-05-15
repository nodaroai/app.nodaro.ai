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
  readonly variantSlug: string | null
  readonly offset: number
}

/**
 * Parse a single @<slug>(:<variant>)? token. The `:` separator is the
 * boundary between character slug and variant slug — each side may contain
 * internal dashes, so `@young-kira:soft-smile` parses unambiguously as
 * `{ characterSlug: "young-kira", variantSlug: "soft-smile" }`.
 *
 * `knownCharacterSlugs` is no longer needed for parsing (the colon is
 * unambiguous) — it remains accepted for API compatibility but ignored here.
 * `findCharacterMentionTokens` still uses it to filter unknown characters.
 */
export function parseCharacterMentionToken(
  text: string,
  _knownCharacterSlugs?: readonly string[],
): { characterSlug: string; variantSlug: string | null } | null {
  if (!text.startsWith("@")) return null
  const rest = text.slice(1)
  if (rest.length === 0 || !/^[a-z]/.test(rest)) return null

  const colonIdx = rest.indexOf(":")
  if (colonIdx === -1) {
    // Bare @character (no variant)
    if (!/^[a-z][a-z0-9-]*$/.test(rest)) return null
    return { characterSlug: rest, variantSlug: null }
  }
  const characterSlug = rest.slice(0, colonIdx)
  const variantSlug = rest.slice(colonIdx + 1)
  if (!/^[a-z][a-z0-9-]*$/.test(characterSlug) || !/^[a-z][a-z0-9-]*$/.test(variantSlug)) {
    return null
  }
  return { characterSlug, variantSlug }
}

/** Find all @-mentions in a prompt that match a known character slug. */
export function findCharacterMentionTokens(
  prompt: string,
  knownCharacterSlugs: readonly string[],
): CharacterMentionTokenInfo[] {
  const tokens: CharacterMentionTokenInfo[] = []
  // @<slug>(:<variant>)? preceded by non-alphanumeric (or start of string) prevents email-like matches.
  const regex = /(?:^|[^a-zA-Z0-9])(@[a-z][a-z0-9-]*(?::[a-z][a-z0-9-]*)?)/g
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
