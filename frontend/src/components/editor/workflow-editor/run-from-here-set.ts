import { isExpandedClone } from "@nodaro/shared"
import type { WorkflowEdge, WorkflowNode } from "@/types/nodes"
import { isExecutableNode } from "./types"

/** Live, non-clone, non-hidden executable nodes — the read-only set used to
 *  size the confirm dialog BEFORE any store mutation. */
export function liveExecutable(nodes: WorkflowNode[]): WorkflowNode[] {
  return nodes.filter(
    (n) => isExecutableNode(n) && !(n as { hidden?: boolean }).hidden && !isExpandedClone(n),
  )
}

/** Forward BFS: all node ids reachable downstream from `startId` (inclusive). */
export function getDownstreamNodeIds(startId: string, edges: WorkflowEdge[]): Set<string> {
  const ids = new Set<string>([startId])
  const queue = [startId]
  while (queue.length > 0) {
    const cur = queue.shift()!
    for (const e of edges)
      if (e.source === cur && !ids.has(e.target)) {
        ids.add(e.target)
        queue.push(e.target)
      }
  }
  return ids
}

/**
 * What "Run from here" on `startId` executes: every live executable node
 * downstream of it (itself included when it runs). One set for the run's
 * confirm gate and for the price a node's "Run from here" button quotes, so
 * the two can never disagree about what the run costs.
 */
export function runFromHereExecutable(startId: string, nodes: WorkflowNode[], edges: WorkflowEdge[]): WorkflowNode[] {
  const ids = getDownstreamNodeIds(startId, edges)
  return liveExecutable(nodes).filter((n) => ids.has(n.id))
}
