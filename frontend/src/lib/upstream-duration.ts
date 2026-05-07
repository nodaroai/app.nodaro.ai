import { extractVideoDurationFromNode } from "@nodaro/shared"
import type { WorkflowNode, WorkflowEdge } from "@/types/nodes"

/** Single-input nodes (loop-video, trim-video). Returns the duration of
 *  the upstream connected via the `"in"` edge, or undefined. */
export function getUpstreamDuration(
  nodeId: string,
  nodes: ReadonlyArray<WorkflowNode>,
  edges: ReadonlyArray<WorkflowEdge>,
): number | undefined {
  const incoming = edges.find((e) => e.target === nodeId)
  if (!incoming) return undefined
  const upstream = nodes.find((n) => n.id === incoming.source)
  if (!upstream) return undefined
  return extractVideoDurationFromNode(upstream.data as Record<string, unknown>)
}

/** Multi-input combine-videos. Returns durations in the SAME ORDER as the
 *  videoUrls the frontend sends — clipOrder if set, else incoming edges
 *  sorted by edge id (stable). Each entry may be undefined. */
export function getCombineUpstreamDurations(
  node: WorkflowNode,
  nodes: ReadonlyArray<WorkflowNode>,
  edges: ReadonlyArray<WorkflowEdge>,
): Array<number | undefined> {
  const data = node.data as Record<string, unknown>
  const clipOrder = data.clipOrder as string[] | undefined
  const incoming = edges.filter((e) => e.target === node.id)

  let orderedSourceIds: string[]
  if (clipOrder?.length) {
    orderedSourceIds = clipOrder.filter((id) => incoming.some((e) => e.source === id))
  } else {
    orderedSourceIds = [...incoming]
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((e) => e.source)
  }

  return orderedSourceIds.map((sourceId) => {
    const upstream = nodes.find((n) => n.id === sourceId)
    return upstream ? extractVideoDurationFromNode(upstream.data as Record<string, unknown>) : undefined
  })
}
