/**
 * Soft-cap helper for the per-variant "selected asset" map persisted on
 * characters / locations / objects (`selected_asset_by_variant`).
 *
 * The map is OPAQUE studio-owned storage:
 *   key   = "<bucket>:<variant>" — the camelCase bucket name + the exact variant
 *           string (e.g. "bodyAngles:front", "angles:3/4 left", "expressions:smile").
 *           The "<bucket>:" prefix disambiguates a variant that exists in more
 *           than one bucket (e.g. "front" lives in both `angles` and `bodyAngles`).
 *   value = the chosen asset URL — one of the URLs already present in that bucket.
 *
 * The platform treats the whole thing as a "dumb map": it never interprets keys,
 * never cross-validates the URL against a bucket, and never lowercases/trims keys
 * (the studio sends them already normalized). The ONLY processing is a pair of
 * conservative soft caps so a misbehaving client can't bloat the row — and
 * overflow is DROPPED SILENTLY rather than rejected with a 400, because the field
 * is a UX convenience and a bad map must never block an identity save.
 *
 * Shared by the three entity upsert routes so the cap rules can't drift between
 * them — mirrors `lib/image-provider.ts` as the single source of truth for the
 * `selected_asset_by_variant` column. (Contrast with `reference_videos_by_variant`,
 * which DOES normalize keys + hard-rejects on overflow — that map is keyed by a
 * caller-owned label we canonicalize; this one carries opaque studio ids.)
 */

/** Max number of variant selections kept per entity (extra keys dropped). */
export const MAX_SELECTED_ASSET_KEYS = 200
/** Max characters of a selected URL (longer values dropped, not truncated). */
export const MAX_SELECTED_ASSET_VALUE_LEN = 2048

export function capSelectedAssetByVariant(
  map: Record<string, string> | undefined,
): Record<string, string> | undefined {
  // Preserve partial-update semantics: `undefined` means "don't touch the row".
  // An explicit `{}` is kept (it clears the map — the studio sends the full map
  // each write, so an empty map is a deliberate "no selections").
  if (!map) return undefined
  const kept = Object.entries(map)
    .filter(([, v]) => typeof v === "string" && v.length <= MAX_SELECTED_ASSET_VALUE_LEN)
    .slice(0, MAX_SELECTED_ASSET_KEYS)
  return Object.fromEntries(kept)
}
