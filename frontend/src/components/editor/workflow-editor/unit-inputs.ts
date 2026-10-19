// @registry-lookup asks the input of the one target type it is given (unitInputHandleOf)
/**
 * A node unit's JSON and many-wire inputs on the canvas's own engine (decided
 * 2026-10-18), routed by the input the wire lands on, ahead of any
 * source-type routing: a JSON input (accepts "look") keeps the wired JSON
 * string, a many-wire input one row per upstream node (`unitInputLanding`,
 * @nodaro/render-rules). Called by the input resolver on every wire before its
 * empty-output skip, so a wired JSON input whose upstream produced nothing is
 * recorded as "" and the unit refuses the run. The mirror of the server's
 * services/workflow-engine/unit-inputs.ts.
 */
import { unitInputLaneOf, unitInputLanding, unitLaneTakesSource, usecaseMediaKindOf, type UnitInputValue } from "@nodaro/render-rules"
import { unitInputHandleOf } from "@/lib/unit-definitions"
import type { WorkflowNode } from "@/types/nodes"

/** What a node unit's lane inputs resolve to. Mirror of backend ResolvedInputs.unitInputs. */
export interface UnitResolvedInputs {
  /** By input id: a JSON input's wired string ("" when wired but its upstream
   *  produced nothing), a many-wire input's rows (one per upstream node, in
   *  edge-list order). Absent when none is wired. */
  unitInputs?: Readonly<Record<string, UnitInputValue>>
}

/**
 * True when the wire was routed here (the resolver then moves on). `source`
 * is the upstream node the value came from (through any teleport) and
 * `sourceHandle` its pip; `output` is undefined when it produced nothing.
 * `textSources` is this engine's text-source set: a parameter picker that is
 * not one lands nothing (`unitLaneTakesSource`), on both engines alike.
 */
export function routeUnitInput(
  inputs: UnitResolvedInputs,
  targetType: string | undefined,
  targetHandle: string | null | undefined,
  source: WorkflowNode,
  sourceHandle: string | null | undefined,
  output: string | undefined,
  textSources: ReadonlySet<string>,
): boolean {
  const handle = unitInputHandleOf(targetType, targetHandle)
  const lane = handle && unitInputLaneOf(handle)
  if (!handle || !lane) return false
  // Wired into a lane input but not a value it can take: claimed, nothing recorded.
  if (!unitLaneTakesSource(source.type, textSources)) return true
  inputs.unitInputs = {
    ...inputs.unitInputs,
    [handle.id]: unitInputLanding(inputs.unitInputs?.[handle.id], {
      many: lane === "many",
      json: lane === "json",
      sourceNodeId: source.id,
      value: output ?? "",
      kind: lane === "many" ? usecaseMediaKindOf(source, sourceHandle) : undefined,
    }),
  }
  return true
}
