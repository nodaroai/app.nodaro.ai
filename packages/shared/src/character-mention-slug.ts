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
 * Parse a single @<slug>(-<variant>)? token. When a list of known character
 * slugs is passed, the parser picks the LONGEST matching prefix as the
 * character slug, treating the rest as the variant. Returns null for non-tokens.
 */
export function parseCharacterMentionToken(
  text: string,
  knownCharacterSlugs?: readonly string[],
): { characterSlug: string; variantSlug: string | null } | null {
  if (!text.startsWith("@")) return null
  const rest = text.slice(1)
  if (rest.length === 0 || !/^[a-z]/.test(rest)) return null

  if (knownCharacterSlugs && knownCharacterSlugs.length > 0) {
    const sorted = [...knownCharacterSlugs].sort((a, b) => b.length - a.length)
    for (const candidate of sorted) {
      if (rest === candidate) return { characterSlug: candidate, variantSlug: null }
      if (rest.startsWith(`${candidate}-`)) {
        const variantSlug = rest.slice(candidate.length + 1)
        return { characterSlug: candidate, variantSlug }
      }
    }
    return null
  }

  const dashIdx = rest.indexOf("-")
  if (dashIdx === -1) return { characterSlug: rest, variantSlug: null }
  return {
    characterSlug: rest.slice(0, dashIdx),
    variantSlug: rest.slice(dashIdx + 1),
  }
}

/** Find all @-mentions in a prompt that match a known character slug. */
export function findCharacterMentionTokens(
  prompt: string,
  knownCharacterSlugs: readonly string[],
): CharacterMentionTokenInfo[] {
  const tokens: CharacterMentionTokenInfo[] = []
  // @-start preceded by non-alphanumeric (or start of string) prevents email-like matches
  const regex = /(?:^|[^a-zA-Z0-9])(@[a-z][a-z0-9-]*)/g
  for (const match of prompt.matchAll(regex)) {
    const token = match[1]
    const offset = (match.index ?? 0) + (match[0].length - token.length)
    const parsed = parseCharacterMentionToken(token, knownCharacterSlugs)
    if (parsed) {
      tokens.push({ token, ...parsed, offset })
    }
  }
  return tokens
}
