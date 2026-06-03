import { getModel, type LabeledOption } from "@nodaro/shared"
import {
  IMAGE_ASPECT_RATIOS,
  VIDEO_ASPECT_RATIOS,
  IMAGE_RESOLUTION_OPTIONS,
  VIDEO_RESOLUTION_OPTIONS,
  VIDEO_DURATION_OPTIONS,
} from "@/components/editor/config-panels/model-options"

/**
 * Mode/tier suffixes that distinguish a frontend provider id from its
 * canonical MODEL_CATALOG base id. e.g. "veo3.1" / "veo3_lite" / "grok-i2v"
 * resolve to "veo3" / "grok" so a company search still matches the variant.
 * Order matters only in that the FIRST suffix that yields a family wins.
 *
 * This is a hand-maintained denylist and will silently miss future variant
 * suffixes (a new "-mini"/"-flash" just won't match a company term — search
 * still finds it by name/desc). The drift-proof endgame is to move
 * variant→base resolution into the catalog itself (an `aliasOf`/`baseId`
 * field or a `getModelFamily(id)` resolver in @nodaro/shared) so search, MCP,
 * and any future consumer share one source of truth. Deferred — out of this
 * feature's scope; accepted as a search-only soft-failure.
 */
const BASE_ID_SUFFIXES = [".1", "_lite", "_fast", "-fast", "-i2v", "-t2v", "-i2i", "-pro"]

/** Company/vendor for a provider id, with a base-id fallback for aliases. */
function familyFor(id: string): string | undefined {
  const direct = getModel(id)?.family
  if (direct) return direct
  for (const suffix of BASE_ID_SUFFIXES) {
    if (id.endsWith(suffix)) {
      const fam = getModel(id.slice(0, -suffix.length))?.family
      if (fam) return fam
    }
  }
  return undefined
}

function optionValues(
  map: Record<string, readonly LabeledOption[]>,
  id: string,
): string[] {
  return (map[id] ?? []).map((o) => o.value)
}

/** Per-id haystack cache — option lists + catalog are static for the session. */
const haystackCache = new Map<string, string>()

/**
 * Build one lowercased search string for a model. Tokens are pulled from the
 * SAME sources that render the real dropdowns, so search can never claim a
 * capability the model doesn't actually offer:
 *   name (label + id + desc), company (family), aspect ratios, resolutions,
 *   and durations (formatted "8s").
 */
export function modelSearchHaystack(value: string, label: string, desc?: string): string {
  const cached = haystackCache.get(value)
  if (cached !== undefined) return cached

  const parts: string[] = [value, label]
  if (desc) parts.push(desc)

  const family = familyFor(value)
  if (family) parts.push(family)

  // Aspect + resolution: ids are unique per kind, so merging image+video maps
  // is safe (only one will have an entry for a given id).
  parts.push(...optionValues(IMAGE_ASPECT_RATIOS, value))
  parts.push(...optionValues(VIDEO_ASPECT_RATIOS, value))
  parts.push(...optionValues(IMAGE_RESOLUTION_OPTIONS, value))
  parts.push(...optionValues(VIDEO_RESOLUTION_OPTIONS, value))

  // Durations -> "8s" tokens.
  for (const d of VIDEO_DURATION_OPTIONS[value] ?? []) {
    parts.push(`${d.value}s`)
  }

  const haystack = parts.join(" ").toLowerCase()
  haystackCache.set(value, haystack)
  return haystack
}

/**
 * Case-insensitive, multi-token AND, substring match. Every whitespace-
 * separated token in `query` must be a substring of `haystack`. An empty or
 * whitespace-only query matches everything.
 */
export function modelMatchesQuery(haystack: string, query: string): boolean {
  const tokens = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
  if (tokens.length === 0) return true
  return tokens.every((token) => haystack.includes(token))
}
