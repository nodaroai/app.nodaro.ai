import {
  REFERENCE_ROLE_PRESETS,
  isUsageMode,
  type UsageMode,
} from "@nodaro/shared"
import { IMAGE_REFERENCE_FORMAT } from "@/lib/image-reference-format"

/**
 * Hybrid-mode role vocabulary for the CHARACTER mention pill — the curated,
 * ordered preset list the swap-menu offers when `IMAGE_REFERENCE_FORMAT ===
 * "hybrid"`. Single source of truth is the shared registry; the menu UI appends
 * a `Custom…` free-form entry on top of this list (not listed here).
 */
export const CHARACTER_ROLE_PRESETS: readonly string[] = REFERENCE_ROLE_PRESETS["wired-character"]

/**
 * The character pill's swap-menu vocabulary for a given reference format —
 * the GATE. Returns the curated role presets in hybrid, or `null` in legacy
 * (the caller then renders the EXISTING, unchanged usage-mode menu). Pure +
 * parameterized (the format is an argument, defaulting to the resolved
 * constant) so the gate decision is a function of its input and trivially
 * unit-testable for both formats without mocking the module constant.
 */
export function characterSwapMenuRoles(
  format: "legacy" | "hybrid" = IMAGE_REFERENCE_FORMAT,
): readonly string[] | null {
  return format === "hybrid" ? CHARACTER_ROLE_PRESETS : null
}

/**
 * Sanitize a free-form custom role into a character-variant-slug-safe token.
 *
 * Deliberately STRICTER than image-ref-view's `sanitizeLabel`: a character role
 * rides the `variantSlug` token slot, whose grammar is `[a-z][a-z0-9-]*` (see
 * `CHAR_REF_PATTERN_CORE` / the shared `parseCharacterMentionToken`). We must
 * NOT change that grammar (Phase D guardrail), so we conform to it here —
 * lower-case, dash-join whitespace, drop out-of-grammar characters, force a
 * leading letter, then collapse dash runs and drop a trailing dash — keeping
 * the emitted `@kira:1:<role>` token re-parseable on reload and matching
 * `characterMentionSlug`'s slugification (so `"gold - ring"` → `"gold-ring"`
 * and `"ring-"` → `"ring"`). (image-ref's label can preserve case/underscores
 * because the `{image:N:label}` grammar is looser.)
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

/**
 * Map a hybrid role string to the character-ref token slot it occupies. A role
 * goes in EXACTLY ONE slot (mutually exclusive), which is precisely why the D1
 * hybrid resolver reads `usageMode ?? variantSlug` verbatim:
 *
 *   - the role IS a `UsageMode` (`face` / `pose` / `style`) → `usageMode`,
 *     clearing `variantSlug`;
 *   - otherwise (`person` / `clothes` / `hair` / `expression` / a Custom role)
 *     → `variantSlug`, clearing `usageMode`.
 *
 * Clearing the sibling slot guarantees a role pick can never emit an invalid
 * 4-part `@kira:1:variant:mode` token (which requires a real variant AND a real
 * mode together). An empty/blank role clears both (the "Default" state).
 */
export function roleToCharacterRefSlots(
  role: string,
): { usageMode: UsageMode | null; variantSlug: string | null } {
  const r = sanitizeRole(role)
  if (!r) return { usageMode: null, variantSlug: null }
  if (isUsageMode(r)) return { usageMode: r, variantSlug: null }
  return { usageMode: null, variantSlug: r }
}
