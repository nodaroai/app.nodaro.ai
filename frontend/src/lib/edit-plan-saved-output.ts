// @registry-lookup reads the JSON of the one node unit a wire leaves from (unitDefinitionOf(src.type))
import { editPlanSavedOutput, resolveEditPlanOutput, type EditPlanEditStatus, type EditPlanSavedOutput } from "@nodaro/shared/edl"
import { isUseCaseNodeType, usecaseDescriptor, usecaseKindHasPlan, type UseCaseNodeType } from "@nodaro/render-rules"
import { unitDefinitionOf } from "./unit-definitions"
import { unitPipJson } from "./unit-compose"

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
 * A use-case node's plan as its `json` pip hands it on (Chapters: its chapter
 * list): the person's review applied, a clip-set edit of a chapter list
 * included, and a plan held as null is none — never the text "null". A type
 * whose result kind has no plan (a layout: Speaker Layout's json is the edit
 * its render drew) hands on what it holds, as held — no review applies to it.
 * The read the server's saved branch makes (`use-case-output.ts ::
 * usecaseSavedNodeOutput`), for the scalar and the JSON consumers alike.
 */
export function usecaseJsonOf(nodeType: string | null | undefined, data: Readonly<Record<string, unknown>>): unknown {
  if (isUseCaseNodeType(nodeType ?? undefined) && !usecaseKindHasPlan(usecaseDescriptor(nodeType as UseCaseNodeType).resultKind)) return data.generatedJson ?? undefined
  return editPlanOutputOf(data)?.json ?? undefined
}

/**
 * What a wire from a node unit's look pip hands a JSON consumer (`unitPipJson`):
 * wrapped, `value` undefined when the output holds none; undefined when the
 * wire does not leave a unit's look pip.
 */
export function unitSourceJsonOf(src: { readonly type?: string; readonly data: unknown }, sourceHandle: string | null | undefined): { readonly value: unknown } | undefined {
  const unit = unitDefinitionOf(src.type)
  return unit ? unitPipJson(unit, src.data as Readonly<Record<string, unknown>>, sourceHandle) : undefined
}

/**
 * The structured JSON a node hands a JSON consumer (Extract Field, JSON
 * Process) that reads its source's data directly, for the pip the wire leaves
 * from: an Edit Plan's plan as the person's review leaves it (the kept clips
 * only, edited hooks included), a use-case node's plan likewise
 * (`usecaseJsonOf`), a node unit's look pip its own output, any other node's
 * `generatedJson`. The server's consumers read the same value off
 * the source's state (`structuredJsonOf`: the plan's seeded `output.json`,
 * from `editPlanSavedOutput`; a unit's `unitOutputs`).
 *
 * `edit-plan-saved-output-sites.test.ts` fails when an executor or resolver
 * reads a source's `generatedJson` without this.
 */
export function sourceJsonOf(src: { readonly type?: string; readonly data: unknown }, sourceHandle?: string | null): unknown {
  const data = src.data as Readonly<Record<string, unknown>>
  if (src.type === "edit-plan") return editPlanOutputOf(data)?.json
  if (isUseCaseNodeType(src.type)) return usecaseJsonOf(src.type, data)
  const unit = unitSourceJsonOf(src, sourceHandle)
  if (unit) return unit.value
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
