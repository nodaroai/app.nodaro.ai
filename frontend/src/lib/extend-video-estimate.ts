import { ltxExtendDurationSec, withWiredSettings } from "@nodaro/shared"
import type { WorkflowEdge, WorkflowNode } from "@/types/nodes"

/**
 * How many of its price row an Extend Video run is charged: the seconds an
 * LTX 2.3 Pro extend adds (its row, `ltx-2.3-pro-extend:per-second`, is per
 * second — the same product the route and a workflow run reserve), else one.
 * A wired Settings node can set the model and the length, so both are read the
 * way the run reads them.
 */
export function extendVideoPricingUnits(
  node: WorkflowNode,
  allNodes: ReadonlyArray<WorkflowNode>,
  edges: ReadonlyArray<WorkflowEdge>,
): number {
  const data = (withWiredSettings(node, allNodes, edges).data ?? {}) as Record<string, unknown>
  return data.provider === "ltx-2.3-pro" ? ltxExtendDurationSec(data.duration) : 1
}
