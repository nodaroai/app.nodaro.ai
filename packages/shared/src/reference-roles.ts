// packages/shared/src/reference-roles.ts
import { DEFAULT_LABEL_BY_SOURCE, type ReferenceSource } from "./types.js"

/**
 * Per-source ORDERED preset role ids (most-useful first) for the editor's role
 * menu. The single source of truth for the curated vocabulary — every menu and
 * the resolver read from here. `Custom…` (free-form) is added by the UI, not
 * listed here. Each list MUST contain the source's `DEFAULT_LABEL_BY_SOURCE`
 * value (guarded by reference-roles.test.ts).
 */
export const REFERENCE_ROLE_PRESETS: Record<ReferenceSource, readonly string[]> = {
  "wired-character": ["person", "face", "clothes", "hair", "pose", "expression", "style"],
  "wired-face": ["face", "person", "expression", "style"],
  "wired-location": ["background", "atmosphere", "as-is", "empty background", "layout", "lighting", "style"],
  "wired-object": ["object", "shape", "material", "color", "texture", "style"],
  "wired-creature": ["creature", "anatomy", "markings", "pose", "color", "style"],
  "wired-image": ["object", "person", "face", "clothes", "background", "style", "pose", "texture"],
  "manual": ["object", "person", "face", "clothes", "background", "style", "pose", "texture"],
}

/** Canonical default role for a source — the value the editor pre-fills and the
 *  resolver falls back to. Aliased to `DEFAULT_LABEL_BY_SOURCE` so the two never
 *  drift. */
export function defaultRoleForSource(source: ReferenceSource): string {
  return DEFAULT_LABEL_BY_SOURCE[source]
}

/**
 * Render the inline reference phrase. `binding` is the caller-formatted slot
 * string: `"reference image A"` (image, lettered) or `"@image_3"` (video).
 * Most roles are nouns and slot into the default template; the two non-noun
 * specials get a hand-tuned phrasing so the prompt reads naturally.
 */
export function roleToPhrase(role: string, binding: string): string {
  const r = role.trim()
  if (!r) return binding
  switch (r) {
    case "as-is":
      return `${binding}, used as-is`
    case "empty background":
      return `the background from ${binding} (without its foreground objects)`
    default:
      return `the ${r} from ${binding}`
  }
}

/**
 * Map a location role SLUG — as it appears in a `@location:N:<slug>` mention
 * token (lowercase, dash-joined, no spaces) — back to its canonical phrase key
 * so `roleToPhrase` matches the non-noun specials. Only the multi-word
 * `wired-location` presets need remapping (`empty-background` → `empty
 * background`); single-token roles and `as-is` (whose phrase key keeps the
 * hyphen) and free-form custom slugs pass through unchanged.
 *
 * Data-driven from `REFERENCE_ROLE_PRESETS["wired-location"]` (the single source
 * of truth for the location vocabulary): a preset whose space→dash slug equals
 * `slug` maps back to the preset's phrase form, so a future multi-word preset is
 * handled with no extra wiring. Mention tokens are slug-form (the grammar
 * segment is `[a-z][a-z0-9-]*`), so the role is stored verbatim on the token and
 * normalized HERE at the consumption points — the location mention resolver
 * (before `roleToPhrase`) and the location role pill (display label). The
 * character side never needs this: character role slugs are single tokens that
 * already equal their phrase key.
 */
export function normalizeRoleSlug(slug: string): string {
  const s = slug.trim()
  if (!s) return s
  for (const preset of REFERENCE_ROLE_PRESETS["wired-location"]) {
    if (preset.toLowerCase().replace(/\s+/g, "-") === s) return preset
  }
  return s
}

/**
 * Role for a FIRST-SIGHT character extra-ref in HYBRID assembly. The `segment`
 * is the role when it is a curated preset for `source`; otherwise the source
 * default. This mirrors the segment→role preset gate the mention-hybrid paths
 * use, minus their custom-role-survival relaxation (an extra has no parsed
 * `usageMode == null` signal to tell a role from a variant pick).
 *
 * Shared by BOTH the image (`renderExtraRefsHybrid` in `prompt-builder.ts`) and
 * video (`resolveVideoReferenceCore` extras first-sight in
 * `video-reference-resolver.ts`) resolvers — and, as of the Reference Roles
 * deferred-follow-up, they share the HELPER **and** its INPUT, so they are
 * fully converged:
 *   - image passes the COALESCED `defaultUsageMode`
 *     (`usageMode` → char-node default → "identical", folded by
 *     `expandExtraRefsToConnectedReferences`).
 *   - video passes its COALESCED `effectiveMode`
 *     (`ex.usageMode` → char-node default (`lookupCharacterBySlug`) →
 *     "identical") — the identical resolution chain, already computed for the
 *     legacy directive path.
 * Both are always defined for a real character extra, so no `variantSlug`
 * fallback is needed on either side. A character whose node default is
 * Face/Pose/Style now resolves an un-overridden extra to that default on BOTH
 * image and video (and consistently with the video legacy path). The single
 * source of truth for the coalescing is the per-ref override → char-node
 * default → "identical" chain, applied at both call sites.
 */
export function firstSightExtraRole(
  segment: string | null | undefined,
  source: ReferenceSource,
): string {
  const s = (segment ?? "").trim()
  return s && REFERENCE_ROLE_PRESETS[source].includes(s) ? s : defaultRoleForSource(source)
}
