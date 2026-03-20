/**
 * Shared BFS utility for computing reachable node IDs along a route.
 * Used by both frontend (RunTargetSelector stale guard) and backend
 * (presentation.ts, app-runner.ts, sub-workflow-handler.ts).
 */

export interface MinimalNode {
  id: string
  type?: string
  data: Record<string, unknown>
}

export interface MinimalEdge {
  source: string
  target: string
}

/**
 * BFS in one direction from a start node.
 */
function bfs(
  startId: string,
  edges: readonly MinimalEdge[],
  direction: "forward" | "backward",
): Set<string> {
  const visited = new Set<string>()
  const queue = [startId]

  while (queue.length > 0) {
    const current = queue.shift()!
    if (visited.has(current)) continue
    visited.add(current)

    for (const edge of edges) {
      if (direction === "forward" && edge.source === current && !visited.has(edge.target)) {
        queue.push(edge.target)
      } else if (direction === "backward" && edge.target === current && !visited.has(edge.source)) {
        queue.push(edge.source)
      }
    }
  }

  return visited
}

/**
 * Compute the set of node IDs reachable along a route.
 * 1. Finds the sub-workflow-input node with matching routeId
 * 2. Finds the sub-workflow-output node with matching routeId
 * 3. BFS forward from input, BFS backward from output, intersect
 * Returns empty set if input or output node not found (stale routeId).
 */
export function getRouteReachableNodeIds(
  nodes: readonly MinimalNode[],
  edges: readonly MinimalEdge[],
  routeId: string,
): Set<string> {
  const inputNode = nodes.find(
    (n) => n.type === "sub-workflow-input" && (n.data as Record<string, unknown>).routeId === routeId,
  )
  const outputNode = nodes.find(
    (n) => n.type === "sub-workflow-output" && (n.data as Record<string, unknown>).routeId === routeId,
  )

  if (!inputNode || !outputNode) return new Set()

  const forwardReachable = bfs(inputNode.id, edges, "forward")
  const backwardReachable = bfs(outputNode.id, edges, "backward")

  const reachable = new Set<string>()
  for (const id of forwardReachable) {
    if (backwardReachable.has(id)) reachable.add(id)
  }

  // Always include input and output
  reachable.add(inputNode.id)
  reachable.add(outputNode.id)

  return reachable
}
