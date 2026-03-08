/**
 * Node reference helpers for the frontend.
 * Finds upstream ancestor nodes for {Node Label} autocomplete.
 * Also builds label→output maps for execution-time resolution.
 */

import type { WorkflowNode, WorkflowEdge } from "@/types/nodes"
import { extractNodeOutput } from "@/components/editor/workflow-editor/execution-graph"
import { resolveNodeRefs } from "@nodaro-shared/node-refs"

export interface NodeRefItem {
  id: string
  label: string
  type: string
}

/**
 * BFS traversal to find all upstream ancestor nodes.
 * Returns nodes sorted by proximity (direct parents first).
 * Handles duplicate labels by appending "(2)", "(3)", etc.
 */
export function getUpstreamNodes(
  nodeId: string,
  nodes: ReadonlyArray<WorkflowNode>,
  edges: ReadonlyArray<WorkflowEdge>,
): NodeRefItem[] {
  const visited = new Set<string>()
  const result: NodeRefItem[] = []
  const queue: string[] = []

  // Start with direct parents
  for (const edge of edges) {
    if (edge.target === nodeId && !visited.has(edge.source)) {
      visited.add(edge.source)
      queue.push(edge.source)
    }
  }

  while (queue.length > 0) {
    const currentId = queue.shift()!
    const node = nodes.find((n) => n.id === currentId)
    if (!node) continue

    const data = node.data as Record<string, unknown>
    const label = (data.label as string) || node.type || currentId

    result.push({
      id: currentId,
      label,
      type: node.type as string,
    })

    // Add parents of current node
    for (const edge of edges) {
      if (edge.target === currentId && !visited.has(edge.source)) {
        visited.add(edge.source)
        queue.push(edge.source)
      }
    }
  }

  // Handle duplicate labels by appending suffix
  const labelCount = new Map<string, number>()
  for (const item of result) {
    labelCount.set(item.label, (labelCount.get(item.label) ?? 0) + 1)
  }
  const labelSeen = new Map<string, number>()
  for (const item of result) {
    if ((labelCount.get(item.label) ?? 0) > 1) {
      const seen = (labelSeen.get(item.label) ?? 0) + 1
      labelSeen.set(item.label, seen)
      if (seen > 1) {
        item.label = `${item.label} (${seen})`
      }
    }
  }

  return result
}

/**
 * Build a label→output map for resolving {Node Label} refs at execution time.
 * Uses extractNodeOutput() to get each upstream node's current output.
 */
export function buildNodeRefMap(
  nodeId: string,
  nodes: ReadonlyArray<WorkflowNode>,
  edges: ReadonlyArray<WorkflowEdge>,
): Map<string, string> {
  const upstream = getUpstreamNodes(nodeId, nodes, edges)
  const map = new Map<string, string>()
  for (const ref of upstream) {
    const node = nodes.find((n) => n.id === ref.id)
    if (!node) continue
    const output = extractNodeOutput(node)
    if (output) map.set(ref.label, output)
  }
  return map
}

/**
 * Resolve {Node Label} references in a text string.
 * Returns the original text if no refs are found or refMap is empty.
 */
export function resolveTextRefs(
  text: string | undefined,
  refMap: Map<string, string>,
): string | undefined {
  if (!text || refMap.size === 0) return text
  return resolveNodeRefs(text, refMap)
}
