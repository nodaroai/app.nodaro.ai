import { ltxRetakeDurationSec, withWiredSettings } from "@nodaro/shared"
import type { WorkflowEdge, WorkflowNode } from "@/types/nodes"

/**
 * How many of its per-second price row a Video Retake run is charged: the
 * seconds of the replaced window (`ltxRetakeDurationSec`, at least 2 — the
 * same reading the route and a workflow run reserve on). A wired Settings node
 * can set the window, so it is read the way the run reads it.
 */
export function videoRetakePricingUnits(
  node: WorkflowNode,
  allNodes: ReadonlyArray<WorkflowNode>,
  edges: ReadonlyArray<WorkflowEdge>,
): number {
  const data = (withWiredSettings(node, allNodes, edges).data ?? {}) as Record<string, unknown>
  return ltxRetakeDurationSec(data.retakeDuration)
}
