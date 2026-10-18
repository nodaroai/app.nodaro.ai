// frontend/src/lib/unit-connections.ts — a node unit's own connection rule
// (tools/units/README.md, "Seams"). A unit declares what each input takes in
// its manifest (unit.json handles.inputs[].accepts); the canvas validator
// (connection-validation.ts) and the add-node popup (node-compatibility.ts) ask
// this module for any wire into a unit, so each is legacy rules ∪ the units'
// declared ones, and no unit needs a hand-written predicate or a row in a
// central table.
// @registry-lookup judges a wire into the one node unit it is given (unitDefinitionOf(targetType))
import { unitInputConnectionAccepted } from "./ffmpeg-handles"
import { unitDefinitionOf } from "./unit-definitions"

// The rule itself lives with the media accept predicates it is built from
// (ffmpeg-handles.ts), so isValidFfmpegConnection can answer a unit with it
// without importing this module back.
export { unitInputConnectionAccepted }

/**
 * The validator's verdict for a wire into `targetType`, or `undefined` when the
 * target is not a node unit (a legacy node keeps its own rule) or the wire
 * names no target handle (judged as before: by the rules every node shares).
 * `sourceType` is the effective source type (entity / lane remap applied).
 */
export function unitConnectionVerdict(
  targetType: string | undefined,
  targetHandle: string | null | undefined,
  sourceType: string | undefined,
): boolean | undefined {
  if (!targetHandle) return undefined
  const unit = unitDefinitionOf(targetType)
  return unit ? unitInputConnectionAccepted(unit, targetHandle, sourceType ?? "") : undefined
}
