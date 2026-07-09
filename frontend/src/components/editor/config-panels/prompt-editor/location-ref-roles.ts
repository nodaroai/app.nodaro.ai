import { REFERENCE_ROLE_PRESETS, isLocationUsageMode, type LocationUsageMode } from "@nodaro/shared"
import { IMAGE_REFERENCE_FORMAT } from "@/lib/image-reference-format"

/**
 * Hybrid-mode role vocabulary for the LOCATION mention pill — the curated,
 * ordered preset list the swap-menu offers when `IMAGE_REFERENCE_FORMAT ===
 * "hybrid"`. Single source of truth is the shared registry; the menu UI appends
 * a `Custom…` free-form entry on top of this list (not listed here), mirroring
 * the character pill. The F2 follow-up widened the location parser to accept any
 * bare non-mode slug as a role, so a custom role now round-trips (a
 * `@loc:1:rooftop` parses back to `role: "rooftop"`).
 */
export const LOCATION_ROLE_PRESETS: readonly string[] = REFERENCE_ROLE_PRESETS["wired-location"]

/**
 * The location pill's swap-menu vocabulary for a given reference format — the
 * GATE. Returns the curated role presets in hybrid, or `null` in legacy (the
 * caller then renders the EXISTING, unchanged usage-mode menu). Pure +
 * parameterized (the format is an argument, defaulting to the resolved
 * constant) so the gate decision is a function of its input and trivially
 * unit-testable for both formats without mocking the module constant. Mirrors
 * `characterSwapMenuRoles`.
 */
export function locationSwapMenuRoles(
  format: "legacy" | "hybrid" = IMAGE_REFERENCE_FORMAT,
): readonly string[] | null {
  return format === "hybrid" ? LOCATION_ROLE_PRESETS : null
}

/**
 * Conform a location role PHRASE (as shown in the menu, e.g. "empty
 * background") to its slug form (`empty-background`). This is the phrase→slug
 * direction — the inverse of the shared `normalizeRoleSlug` (slug→phrase) for
 * the curated presets, which matches a preset when
 * `preset.toLowerCase().replace(/\s+/g, "-") === slug`. Slugifying the phrase
 * the same way (lower-case, dash-join whitespace) therefore guarantees the
 * emitted `@loc:1:<slug>` token re-parses (and `normalizeRoleSlug`s) back to
 * this exact preset.
 *
 * Also conforms to the location token's bare-slug segment grammar
 * `[a-z][a-z0-9-]*` (drop out-of-grammar characters, force a leading letter,
 * collapse dash runs, drop a trailing dash) — load-bearing now that the pill
 * accepts a free-form Custom role (e.g. `"Rooftop View"` → `"rooftop-view"`),
 * keeping the emitted `@loc:1:<slug>` token re-parseable on reload.
 */
export function sanitizeLocationRole(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/^[^a-z]+/, "") // grammar requires a leading [a-z]
    .slice(0, 32)
    .replace(/-+/g, "-") // collapse dash runs (matches locationMentionSlug)
    .replace(/-$/, "") // drop a trailing dash (incl. one left by the 32-cap)
}

/** The token-slot update a location role pick produces. In the plain form a
 *  role fills at most ONE of `role`/`usageMode` and clears `bucket`/`variant`;
 *  in the `hasVariant` form (Variant + Role Separation) `bucket`/`variant` are
 *  OMITTED so `updateAttributes` (which merges partials) leaves the pill's
 *  real variant untouched — the serialized token becomes the 4-part
 *  `:bucket/variant:role` (or `:bucket/variant:mode`). */
export interface LocationRefRoleSlots {
  role: string | null
  usageMode: LocationUsageMode | null
  bucket?: null
  variant?: null
}

/**
 * Map a hybrid location role string to the location-ref token slot it occupies.
 * A role goes in EXACTLY ONE slot (mutually exclusive); bucket/variant are
 * always cleared (a role pill is never also a specific variant pill):
 *
 *   - the role's slug IS a `LocationUsageMode` (`layout` / `style`) → `usageMode`.
 *     These two presets are ALSO usage modes, and the D1 parser resolves a bare
 *     `@loc:1:layout` to `usageMode` (checked before the role branch). Routing
 *     them to `usageMode` keeps the attrs PARSER-STABLE — serialize → re-parse
 *     yields the same slot, so the pill never silently "flips" on reload.
 *   - otherwise (`background` / `atmosphere` / `as-is` / `empty-background` /
 *     `lighting`) → `role`, which `renderText` serializes as the bare 3rd
 *     segment the (now un-gated, F2) parser reads back as a role — presets and
 *     free-form Custom roles alike.
 *
 * Clearing the sibling slots guarantees a role pick can never emit an invalid
 * multi-segment token. A blank role clears everything (the "Default" state).
 *
 * Mirrors `roleToCharacterRefSlots`, which likewise routes UsageMode roles to
 * the `usageMode` slot for exactly this parser-stability reason.
 */
export function roleToLocationRefSlots(
  role: string,
  opts?: { hasVariant?: boolean },
): LocationRefRoleSlots {
  const slug = sanitizeLocationRole(role)
  // Variant + Role Separation: with a REAL bucket/variant on the pill, the
  // role pick PRESERVES it (bucket/variant omitted → updateAttributes merge
  // leaves them alone) and routes to the 4th segment — usageMode for the two
  // mode-presets (parser-stable), else the role slot.
  if (opts?.hasVariant) {
    if (!slug) return { role: null, usageMode: null }
    if (isLocationUsageMode(slug)) return { role: null, usageMode: slug }
    return { role: slug, usageMode: null }
  }
  if (!slug) return { role: null, usageMode: null, bucket: null, variant: null }
  if (isLocationUsageMode(slug)) {
    return { role: null, usageMode: slug, bucket: null, variant: null }
  }
  return { role: slug, usageMode: null, bucket: null, variant: null }
}
