import { PARAMETER_NODE_TYPES } from "./parameter-node-value.js"

/**
 * The 5 parameter-picker node types that can wire INTO the Object Studio's
 * `type` input handle as upstream identity providers (Material, Animal,
 * Vehicle, Weapon, Furniture). The resolver in
 * `backend/src/services/workflow-engine/input-resolver.ts` (and its frontend
 * mirror) reads this set to discriminate wired pickers from arbitrary source
 * nodes when composing the seedPromptHint.
 *
 * Defensive filter: if `PARAMETER_NODE_TYPES` doesn't yet contain `"furniture"`
 * (i.e., the Furniture prereq PR hasn't been deployed in this environment),
 * furniture silently drops from the set. The wired-picker resolver then
 * skips furniture pickers without error rather than firing a wrong prompt
 * fragment. Production deploy order is enforced as: Prereq PR (#2601, merged)
 * → Object Studio PRs; this defensive code is a safety net.
 */
export const OBJECT_PICKER_NODE_TYPES: ReadonlySet<string> = new Set(
  ["material", "animal", "vehicle", "weapon", "furniture"].filter((t) =>
    PARAMETER_NODE_TYPES.has(t),
  ),
)
