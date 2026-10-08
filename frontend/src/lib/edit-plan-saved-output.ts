import { editPlanSavedOutput, resolveEditPlanOutput, type EditPlanEditStatus, type EditPlanSavedOutput } from "@nodaro/shared"

/**
 * An Edit Plan node's saved output with the person's review applied — the ONE
 * read every editor reader of an Edit Plan makes (the scalar and list outputs,
 * the fan-out count, the render estimate, the node's own badge). It is
 * `@nodaro/shared`'s `editPlanSavedOutput`, the read the server makes too
 * (`output-extractor.ts :: extractSavedNodeOutput`, `saved-data.ts ::
 * savedListFor`), so both engines hand a render the same clips (TA13, TA16).
 *
 * Cached per plan object. The canvas reads these on hot paths (store selectors,
 * the run estimate). Node data is never mutated in place, so the same
 * `generatedJson` object with the same `editedEdl` object always resolves the
 * same way; a new plan or a new edit is a new object and misses. A hit returns
 * the SAME `listResults` array, which keeps a selector built on it stable. A
 * miss on a new edit of the same plan does not re-hash it: the shared
 * `editPlanBasis` keeps each plan object's basis.
 *
 * `frontend/src/lib/__tests__/edit-plan-saved-output-sites.test.ts` fails when
 * an editor read of an Edit Plan's saved output skips this.
 */
const cache = new WeakMap<object, { readonly edited: unknown; readonly output: EditPlanSavedOutput | undefined }>()

export function editPlanOutputOf(data: Readonly<Record<string, unknown>>): EditPlanSavedOutput | undefined {
  const plan = data.generatedJson
  if (typeof plan !== "object" || plan === null) return editPlanSavedOutput(data)
  const edited = data.editedEdl
  const hit = cache.get(plan)
  if (hit && hit.edited === edited) return hit.output
  const output = editPlanSavedOutput(data)
  cache.set(plan, { edited, output })
  return output
}

/**
 * The structured JSON a node hands a JSON consumer (Extract Field, JSON
 * Process) that reads its source's data directly: an Edit Plan's plan as the
 * person's review leaves it (the kept clips only, edited hooks included), any
 * other node's `generatedJson`. The server's consumers read the same value off
 * the plan's seeded state (`output.json`, from `editPlanSavedOutput`).
 *
 * `edit-plan-saved-output-sites.test.ts` fails when an executor or resolver
 * reads a source's `generatedJson` without this.
 */
export function sourceJsonOf(src: { readonly type?: string; readonly data: unknown }): unknown {
  const data = src.data as Readonly<Record<string, unknown>>
  if (src.type === "edit-plan") return editPlanOutputOf(data)?.json
  return data.generatedJson
}

const statusCache = new WeakMap<object, { readonly edited: unknown; readonly status: EditPlanEditStatus }>()

/**
 * Where the person's review of an Edit Plan stands (`resolveEditPlanOutput`'s
 * status): `applied` (the plan hands on their edit), `stale` (made on an earlier
 * plan, ignored), `invalid`, or `none`. Cached per plan object like
 * `editPlanOutputOf`, for the node's EDITED chip, which asks on every render.
 */
export function editPlanEditStatusOf(data: Readonly<Record<string, unknown>>): EditPlanEditStatus {
  const plan = data.generatedJson
  if (plan === undefined || plan === null) return "none"
  if (typeof plan !== "object") return resolveEditPlanOutput(plan, data.editedEdl).status
  const edited = data.editedEdl
  const hit = statusCache.get(plan)
  if (hit && hit.edited === edited) return hit.status
  const { status } = resolveEditPlanOutput(plan, edited)
  statusCache.set(plan, { edited, status })
  return status
}
