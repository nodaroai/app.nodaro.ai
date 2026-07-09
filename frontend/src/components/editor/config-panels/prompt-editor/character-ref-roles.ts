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

/** The partial attr update a role pick produces. `variantSlug` is OMITTED in
 *  the `hasVariant` form so `updateAttributes` (which merges partials) leaves
 *  the pill's real variant untouched. */
export interface CharacterRefRoleSlots {
  usageMode: UsageMode | null
  variantSlug?: string | null
  role: string | null
}

/**
 * Map a hybrid role string to the character-ref token slot it occupies.
 *
 * WITHOUT a real variant (`opts.hasVariant` falsy — the pre-existing behavior):
 *   - the role IS a `UsageMode` (`face` / `pose` / `style`) → `usageMode`,
 *     clearing `variantSlug`;
 *   - otherwise (`person` / `clothes` / … / a Custom role) → `variantSlug`,
 *     clearing `usageMode`.
 *   A blank role clears all slots (the "Default" state). `role` is always
 *   cleared on this path — the 4th-segment slot is only meaningful with a
 *   variant in front of it.
 *
 * WITH a real variant (`opts.hasVariant` — Variant + Role Separation): the
 * variant is PRESERVED (the update omits `variantSlug` entirely) and the role
 * routes to the 4th segment — `usageMode` when it is a mode (`:variant:mode`,
 * today's valid shape), else the new `role` attr (`:variant:role`). A blank
 * role clears role+mode but keeps the variant (Default keeps the image).
 */
export function roleToCharacterRefSlots(
  role: string,
  opts?: { hasVariant?: boolean },
): CharacterRefRoleSlots {
  const r = sanitizeRole(role)
  if (opts?.hasVariant) {
    if (!r) return { usageMode: null, role: null }
    if (isUsageMode(r)) return { usageMode: r, role: null }
    return { usageMode: null, role: r }
  }
  if (!r) return { usageMode: null, variantSlug: null, role: null }
  if (isUsageMode(r)) return { usageMode: r, variantSlug: null, role: null }
  return { usageMode: null, variantSlug: r, role: null }
}
