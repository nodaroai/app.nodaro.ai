import { REFERENCE_ROLE_PRESETS, isUsageMode, sanitizeRole, type UsageMode } from "@nodaro/shared"
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
 * `sanitizeRole` was HOISTED to `@nodaro/shared` (`reference-roles.ts`) so the
 * mention pill and the character node's role dropdown share one source of
 * truth. Re-exported here so existing importers (pill views, tests) keep
 * working unchanged. See the shared docstring for the grammar rationale
 * (`[a-z][a-z0-9-]*` — the `variantSlug` token slot).
 */
export { sanitizeRole }

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
