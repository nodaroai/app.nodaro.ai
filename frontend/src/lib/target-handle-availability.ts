import { CAMERA_SWITCH_SPEAKER_MAP_HANDLE } from "@nodaro/render-rules"
import { isNodeUnavailable, surfaceAvailabilityLoaded } from "./surface-availability"

/**
 * Input pips that follow another node's availability.
 *
 * Some inputs exist for one node's result alone: Camera Switch's Speaker map
 * takes what Speaker Map works out, and nothing else makes that result. While
 * the deployment withholds that node from the viewer (Admin → Availability
 * hides it from users; admins still see it), the pip is withheld with it — not
 * drawn on the node, not offered by a pip popover or the add-node popup, and a
 * new wire to it is refused on the canvas. The viewer's answer is the one the
 * Add Node picker reads (`isNodeUnavailable`), so the pip appears the moment
 * the node does, with no list of its own. Until that answer has landed the
 * input is withheld (hidden until loaded, never the reverse): the static
 * profile the picker falls back to does not carry the admin switch that hides
 * a node in production, and a failed fetch keeps it withheld for the session.
 *
 * Withholding is the EDITOR's offer only. The input stays declared
 * (NODE_DEFINITIONS, the MCP handle table), so a wire already saved — or
 * written by an agent — still resolves and runs; the node draws its pip while
 * such a wire is attached (`targetHandleShown`), never an invisible edge.
 */
const TARGET_HANDLE_FOLLOWS: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  "camera-switch": { [CAMERA_SWITCH_SPEAKER_MAP_HANDLE]: "speaker-map" },
}

/** The node type whose availability this input follows, if any. */
export function targetHandleGovernedBy(nodeType: string | undefined, handleId: string | null | undefined): string | undefined {
  if (!nodeType || !handleId) return undefined
  return TARGET_HANDLE_FOLLOWS[nodeType]?.[handleId]
}

/** True when the viewer is not offered this input: the node it exists for is
 *  withheld from them, or their availability answer has not landed yet. */
export function isTargetHandleWithheld(nodeType: string | undefined, handleId: string | null | undefined): boolean {
  const governedBy = targetHandleGovernedBy(nodeType, handleId)
  return governedBy !== undefined && (!surfaceAvailabilityLoaded() || isNodeUnavailable(governedBy))
}

/**
 * Whether a node draws this input pip: when it is offered to the viewer, or
 * when a wire already lands on it (a hidden pip under a live wire is an edge
 * the canvas cannot draw). `edges` are the CANVAS's own (React Flow's store):
 * a template or tutorial canvas draws edges the workflow store never holds,
 * and never loads availability. Callers subscribe to availability
 * (`useSurfaceAvailability`) so the pip appears when the answer lands.
 */
export function targetHandleShown(
  nodeId: string,
  nodeType: string,
  handleId: string,
  edges: ReadonlyArray<{ readonly target: string; readonly targetHandle?: string | null }>,
): boolean {
  if (!isTargetHandleWithheld(nodeType, handleId)) return true
  return edges.some((e) => e.target === nodeId && e.targetHandle === handleId)
}
