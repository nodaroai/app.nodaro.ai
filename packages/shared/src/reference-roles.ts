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
  "wired-character": ["ref-only", "person", "face", "clothes", "hair", "pose", "expression", "style"],
  "wired-face": ["face", "person", "expression", "style"],
  "wired-location": ["ref-only", "background", "atmosphere", "as-is", "empty background", "layout", "lighting", "style"],
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
    case "ref-only":
      // Bare reference pointer — no descriptive phrase. The label-less/default
      // state for media refs; an explicit pick for character/location assets.
      return binding
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

/**
 * The effective default role for a wired entity, given the node's explicit
 * hybrid `defaultRole` and its legacy `defaultUsageMode`. Single source of truth
 * for the node-default precedence, read at every hybrid resolver site (image +
 * video × extras / canonical / mention):
 *
 *   1. `defaultRole` (the hybrid dropdown pick) — used VERBATIM when non-blank,
 *      so a Custom role like `earrings` survives (mirrors the pill's Custom
 *      relaxation) and beats any legacy `defaultUsageMode`.
 *   2. else `firstSightExtraRole(defaultUsageMode, source)` — the back-compat
 *      mapping (`face`/`pose`/`style` pass through; every other usage mode, and
 *      an absent one, collapse to the source default, e.g. `"person"`).
 *
 * A per-mention token role (the pill / autocomplete) still wins over this at the
 * mention call sites; this is only the NODE-level fallback.
 */
export function resolveDefaultRole(
  defaultRole: string | null | undefined,
  defaultUsageMode: string | null | undefined,
  source: ReferenceSource,
): string {
  const explicit = defaultRole?.trim()
  if (explicit) return explicit
  return firstSightExtraRole(defaultUsageMode, source)
}

/**
 * Sanitize a free-form Custom role into a character-variant-slug-safe token.
 * Hoisted to shared (was `config-panels/prompt-editor/character-ref-roles.ts`)
 * so BOTH the mention pill and the character node's role dropdown share one
 * source of truth. Grammar is `[a-z][a-z0-9-]*` (the `variantSlug` token slot):
 * lower-case, dash-join whitespace, drop out-of-grammar chars, force a leading
 * letter, cap at 32, collapse dash runs, drop a trailing dash — keeping the
 * emitted role re-parseable and matching `characterMentionSlug`'s slugification.
 */
export function sanitizeRole(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/^[^a-z]+/, "") // grammar requires a leading [a-z]
    .slice(0, 32)
    .replace(/-+/g, "-") // collapse dash runs (matches characterMentionSlug)
    .replace(/-$/, "") // drop a trailing dash (incl. one left by the 32-cap)
}
