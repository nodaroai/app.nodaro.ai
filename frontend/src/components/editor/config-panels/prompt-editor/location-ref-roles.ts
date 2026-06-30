import {
  REFERENCE_ROLE_PRESETS,
  isLocationUsageMode,
  type LocationUsageMode,
} from "@nodaro/shared"
import { IMAGE_REFERENCE_FORMAT } from "@/lib/image-reference-format"

/**
 * Hybrid-mode role vocabulary for the LOCATION mention pill — the curated,
 * ordered preset list the swap-menu offers when `IMAGE_REFERENCE_FORMAT ===
 * "hybrid"`. Single source of truth is the shared registry. Unlike the
 * character pill, the location menu does NOT append a `Custom…` entry: the
 * location parser is PRESET-GATED (a `@loc:1:foobar` returns null → literal
 * text), so a free-form role could never round-trip. Custom is a deferred
 * follow-up that would require widening the parser.
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
 * `[a-z][a-z0-9-]*` (drop out-of-grammar characters, force a leading letter) —
 * defensive for any future multi-word/punctuated preset, though today every
 * input is a clean curated preset (no Custom for location).
 */
export function sanitizeLocationRole(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/^[^a-z]+/, "") // grammar requires a leading [a-z]
    .slice(0, 32)
}

/** The mutually-exclusive token-slot set a location role resolves into. A
 *  location token is role XOR bucket/variant XOR mode, so a role pick fills at
 *  most ONE of `role`/`usageMode` and always clears `bucket`/`variant`. */
export interface LocationRefRoleSlots {
  role: string | null
  usageMode: LocationUsageMode | null
  bucket: null
  variant: null
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
 *     segment the preset-gated D1 parser reads back as a role.
 *
 * Clearing the sibling slots guarantees a role pick can never emit an invalid
 * multi-segment token. A blank role clears everything (the "Default" state).
 *
 * Mirrors `roleToCharacterRefSlots`, which likewise routes UsageMode roles to
 * the `usageMode` slot for exactly this parser-stability reason.
 */
export function roleToLocationRefSlots(role: string): LocationRefRoleSlots {
  const slug = sanitizeLocationRole(role)
  if (!slug) return { role: null, usageMode: null, bucket: null, variant: null }
  if (isLocationUsageMode(slug)) {
    return { role: null, usageMode: slug, bucket: null, variant: null }
  }
  return { role: slug, usageMode: null, bucket: null, variant: null }
}
