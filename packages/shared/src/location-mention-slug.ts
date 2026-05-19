/**
 * Location `@-mention` parser. Mirrors `character-mention-slug.ts` shape but
 * with two key differences:
 *
 *   1. **Bucketed variants:** the 3rd segment can be `bucket/variant` (slash-
 *      separated, e.g. `weather/rain` or `lighting/cinematic`) in addition
 *      to a bare usage-mode keyword. Locations carry their variants split
 *      across 5 buckets (timeOfDay / weather / seasons / angles / lighting)
 *      plus motion clips; the bucket prefix disambiguates which array to
 *      pull from when two buckets happen to share a variant name.
 *
 *   2. **Smaller usage-mode set:** locations support 4 modes ("identical",
 *      "style", "layout", "none") — a strict subset of the 8 character modes.
 *      The character modes "face" / "face-pose" / "pose" / "emotion" / "name"
 *      don't apply to scenes.
 *
 * The mention resolver (Phase 2 #2 follow-up) uses the parsed token to look
 * up the variant URL by walking the upstream Location node's `node.data`:
 * timeOfDay / weather / seasons / angles / lighting / atmosphereMotions
 * arrays, each `{name, url}`. Slug match is case-insensitive via the same
 * slugify helper used by character variants.
 *
 * Format reference (the parser accepts these shapes; everything else returns
 * null and the token falls through to literal-text in the final prompt):
 *
 *   @oldlibrary:1                       — canonical, default mode
 *   @oldlibrary:1:weather/rain          — rain variant from weather bucket
 *   @oldlibrary:1:layout                — canonical, mode "layout"
 *   @oldlibrary:1:weather/rain:style    — variant + mode override
 *   @oldlibrary:1:weather/rain:bogus    — null (4th segment must be a known
 *                                          location usage mode)
 */

/** Modes that apply to scenes/locations. Subset of character `USAGE_MODES`. */
export const LOCATION_USAGE_MODES = [
  "identical",
  "style",
  "layout",
  "none",
] as const

export type LocationUsageMode = (typeof LOCATION_USAGE_MODES)[number]

/** Default mode when neither the slug nor the location node specifies one. */
export const DEFAULT_LOCATION_USAGE_MODE: LocationUsageMode = "identical"

/** Type guard — narrows an arbitrary string to `LocationUsageMode`. */
export function isLocationUsageMode(s: string): s is LocationUsageMode {
  return (LOCATION_USAGE_MODES as readonly string[]).includes(s)
}

/**
 * Slugify a location name for use in @-mention tokens. Same algorithm as
 * `characterMentionSlug` — lowercase, strip non-alphanumeric, collapse runs.
 * Kept as a separate export to make the call site's intent explicit and to
 * allow future divergence (e.g., locations may need to preserve digits at
 * the start, characters may not).
 */
export function locationMentionSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
}

export interface LocationMentionTokenInfo {
  readonly token: string
  readonly locationSlug: string
  readonly imageIndex: number
  /** "weather", "lighting", etc. — null when the mention targets the canonical
   *  main image. */
  readonly bucket: string | null
  /** Variant name within the bucket (e.g. "rain"). null for canonical. */
  readonly variant: string | null
  /** Per-mention mode override; null falls back to the location node's default
   *  (or the global "identical" default). */
  readonly usageMode: LocationUsageMode | null
  /** Byte offset into the source prompt — used to splice the token out at
   *  resolve time. */
  readonly offset: number
}

/**
 * Parse a single `@<location>:<index>(:<bucket>/<variant>|<mode>)?(:<mode>)?`
 * token. Returns null when the token doesn't match any supported shape
 * (caller falls back to literal text).
 *
 * Disambiguation at the 3rd segment: presence of `/` indicates a
 * bucket/variant pair; absence indicates a bare mode keyword. The 4th
 * segment is always a mode override (and must be a valid `LocationUsageMode`).
 */
export function parseLocationMentionToken(
  text: string,
): {
  locationSlug: string
  imageIndex: number
  bucket: string | null
  variant: string | null
  usageMode: LocationUsageMode | null
} | null {
  if (!text.startsWith("@")) return null
  const rest = text.slice(1)
  if (rest.length === 0 || !/^[a-z]/.test(rest)) return null

  const parts = rest.split(":")
  if (parts.length < 2 || parts.length > 4) return null

  const [locationSlug, indexStr, third, fourth] = parts
  if (!/^[a-z][a-z0-9-]*$/.test(locationSlug)) return null
  if (!/^\d+$/.test(indexStr)) return null
  const imageIndex = parseInt(indexStr, 10)
  if (!Number.isInteger(imageIndex) || imageIndex < 1) return null

  // 2-part: @oldlibrary:1 — canonical, default mode.
  if (parts.length === 2) {
    return {
      locationSlug,
      imageIndex,
      bucket: null,
      variant: null,
      usageMode: null,
    }
  }

  // 3-part: @oldlibrary:1:X — X is either bucket/variant or a mode keyword.
  if (parts.length === 3) {
    if (third.includes("/")) {
      const slashAt = third.indexOf("/")
      const bucket = third.slice(0, slashAt)
      const variant = third.slice(slashAt + 1)
      if (!/^[a-z][a-z0-9-]*$/.test(bucket)) return null
      if (!/^[a-z][a-z0-9-]*$/.test(variant)) return null
      return { locationSlug, imageIndex, bucket, variant, usageMode: null }
    }
    if (!/^[a-z][a-z0-9-]*$/.test(third)) return null
    if (isLocationUsageMode(third)) {
      return {
        locationSlug,
        imageIndex,
        bucket: null,
        variant: null,
        usageMode: third,
      }
    }
    // Unknown 3rd segment — neither bucket/variant nor a known mode. Return
    // null so the resolver falls through to literal text.
    return null
  }

  // 4-part: @oldlibrary:1:bucket/variant:mode.
  if (parts.length === 4) {
    if (!third.includes("/")) return null
    const slashAt = third.indexOf("/")
    const bucket = third.slice(0, slashAt)
    const variant = third.slice(slashAt + 1)
    if (!/^[a-z][a-z0-9-]*$/.test(bucket)) return null
    if (!/^[a-z][a-z0-9-]*$/.test(variant)) return null
    if (!isLocationUsageMode(fourth)) return null
    return { locationSlug, imageIndex, bucket, variant, usageMode: fourth }
  }

  return null
}

/**
 * Find all location @-mentions in a prompt that match a known location slug.
 *
 * The regex captures every `@<slug>:<index>(:<segment>)?(:<segment>)?` shape
 * where each segment is either `[a-z][a-z0-9-]*` (the character format —
 * shared with characters) or `[a-z][a-z0-9-]*\/[a-z][a-z0-9-]*` (the
 * bucket/variant format — location-only). `knownLocationSlugs` filters to
 * only the user's wired locations so `@kira:1:smile` doesn't accidentally
 * trip the location parser.
 */
export function findLocationMentionTokens(
  prompt: string,
  knownLocationSlugs: readonly string[],
): LocationMentionTokenInfo[] {
  const tokens: LocationMentionTokenInfo[] = []
  // Each optional segment is either a plain slug (`[a-z][a-z0-9-]*`) OR a
  // bucket/variant pair (`[a-z][a-z0-9-]*\/[a-z][a-z0-9-]*`). The two are
  // disjoint at the regex level — bucket/variant requires the literal `/`.
  const segment = "(?:[a-z][a-z0-9-]*\\/[a-z][a-z0-9-]*|[a-z][a-z0-9-]*)"
  const regex = new RegExp(
    `(?:^|[^a-zA-Z0-9])(@[a-z][a-z0-9-]*:\\d+(?::${segment})?(?::${segment})?)`,
    "g",
  )
  const knownSet = new Set(knownLocationSlugs)
  for (const match of prompt.matchAll(regex)) {
    const token = match[1]
    const offset = (match.index ?? 0) + (match[0].length - token.length)
    const parsed = parseLocationMentionToken(token)
    if (parsed && knownSet.has(parsed.locationSlug)) {
      tokens.push({ token, ...parsed, offset })
    }
  }
  return tokens
}
