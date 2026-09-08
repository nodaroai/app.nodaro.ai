/**
 * Apply deterministic edit operations to a scene IN THE BROWSER.
 *
 * The user drags a number and the scene must change immediately — a round trip
 * per keystroke would be unusable and would bill an LLM job for arithmetic. So
 * the canvas applies the operation locally, and it applies it with the SAME
 * function the API route uses (`applyScene3DEditOperations` from
 * `@nodaro/shared`) so the browser can never mint a revision the server would
 * have produced differently. This module is the only place the frontend
 * touches that function.
 *
 * The input plan is never mutated: the shared applier deep-clones and returns a
 * NEW plan carrying a fresh `revisionId` and the previous one as
 * `parentRevisionId`. It never throws — a rejected edit (removing an object
 * something else parents to, a stale revision, a locked object) comes back as
 * `{ ok: false, message }`.
 */
import { applyScene3DEditOperations } from "@nodaro/shared"
import type { Scene3DPlanV1 } from "@nodaro/shared"
import type { Scene3DEditOperationLike } from "./edit-operations"

export type LocalEditResult =
  | { ok: true; plan: Record<string, unknown>; changeSummary: string }
  | { ok: false; error: string }

export function applyLocalSceneEdits(
  plan: Record<string, unknown>,
  operations: readonly Scene3DEditOperationLike[],
  options?: { expectedRevisionId?: string; lockedObjectIds?: readonly string[] },
): LocalEditResult {
  if (operations.length === 0) return { ok: true, plan, changeSummary: "" }
  // `Scene3DEditOperationLike` IS the shared operation union, so the list needs
  // no cast; only the plan does (the canvas stores it untyped on purpose, and
  // the applier validates it before touching anything).
  const result = applyScene3DEditOperations(plan as unknown as Scene3DPlanV1, operations, options ?? {})
  if (!result.ok) return { ok: false, error: result.message }
  return {
    ok: true,
    plan: result.plan as unknown as Record<string, unknown>,
    changeSummary: result.changeSummary,
  }
}
