import type { WorkflowNode, WorkflowEdge } from "@/types/nodes"
import { buildExecutionLevels } from "@/components/editor/workflow-editor/execution-graph"

const NODE_WIDTH = 260
const NODE_HEIGHT = 120
const Y_GAP = 40

/**
 * Generate mobile positions for nodes using topological sort.
 * Produces a vertical single-column layout centered in the viewport.
 */
export function generateMobilePositions(
  nodes: WorkflowNode[],
  edges: WorkflowEdge[],
  viewportWidth: number,
): Map<string, { x: number; y: number }> {
  const positions = new Map<string, { x: number; y: number }>()
  const centerX = Math.max(20, (viewportWidth - NODE_WIDTH) / 2)

  // Use execution-level topological sort for ordering
  const levels = buildExecutionLevels(nodes, edges)
  const ordered = levels.flat()

  // Find orphan nodes not in any level (disconnected from the graph)
  const orderedIds = new Set(ordered.map((n) => n.id))
  const orphans = nodes.filter((n) => !orderedIds.has(n.id))

  let y = 40
  for (const node of ordered) {
    positions.set(node.id, { x: centerX, y })
    y += NODE_HEIGHT + Y_GAP
  }
  for (const node of orphans) {
    positions.set(node.id, { x: centerX, y })
    y += NODE_HEIGHT + Y_GAP
  }

  return positions
}

/**
 * Ensure all nodes have mobilePosition set.
 * Only generates positions for nodes missing mobilePosition;
 * existing mobile positions are preserved.
 * Returns a new nodes array if any were updated, otherwise the original.
 */
export function ensureMobilePositions(
  nodes: WorkflowNode[],
  edges: WorkflowEdge[],
  viewportWidth: number,
): WorkflowNode[] {
  const hasMissing = nodes.some((n) => !n.mobilePosition)
  if (!hasMissing) return nodes

  const generated = generateMobilePositions(nodes, edges, viewportWidth)
  return nodes.map((node) => {
    if (node.mobilePosition) return node
    const pos = generated.get(node.id)
    return pos ? { ...node, mobilePosition: pos } : node
  })
}
