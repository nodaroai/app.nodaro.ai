/**
 * Utilities for detecting and filtering expanded loop clones.
 * Shared between frontend (store, persistence, execution) and backend (orchestrator).
 */

import type { GenericNode, GenericEdge } from "./types.js"

/** Matches node IDs like `node_7_iter_0`, `node_7_iter_1`, etc. */
export const ITER_CLONE_PATTERN = /_iter_\d+$/

/** Returns true if the node is an expanded loop clone (by flag or ID pattern). */
export function isExpandedClone(node: GenericNode): boolean {
  return !!(node.data as Record<string, unknown>).__expandedClone || ITER_CLONE_PATTERN.test(node.id)
}

/**
 * Filter out expanded clone nodes and edges that reference them.
 * Unhides original nodes that were hidden during loop expansion.
 * Optionally filters sub-workflow nodes (prefix `__sub_`).
 */
export function filterCloneNodes<N extends GenericNode, E extends GenericEdge>(
  nodes: N[],
  edges: E[],
  options?: { filterSubWorkflow?: boolean },
): { nodes: N[]; edges: E[] } {
  const filterSub = options?.filterSubWorkflow ?? false

  const cloneIds = new Set(
    nodes.filter((n) => isExpandedClone(n)).map((n) => n.id),
  )

  const filteredNodes = nodes
    .filter((n) => {
      if (cloneIds.has(n.id)) return false
      if (filterSub && n.id.startsWith("__sub_")) return false
      return true
    })
    .map((n) => (n.hidden ? { ...n, hidden: false } as N : n))

  const filteredEdges = edges.filter((e) => {
    if (filterSub && (e as { id?: string }).id?.startsWith("__sub_")) return false
    return !cloneIds.has(e.source) && !cloneIds.has(e.target)
  })

  return { nodes: filteredNodes, edges: filteredEdges }
}
