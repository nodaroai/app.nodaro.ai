/**
 * Infer downstream prompt context for presentation-mode prompt enhancement.
 * Walks edges forward from an input node via BFS to find the first
 * prompt-consuming downstream node (image gen, video gen, etc.).
 */

import { hasPromptConsumerType } from "@/components/editor/config-panels/prompt-helper-styles"

export interface PromptContext {
  nodeType: string
  provider?: string
  aspectRatio?: string
  duration?: number
}

/**
 * BFS forward through edges from `nodeId` to find the first downstream node
 * whose type is a known prompt consumer (image/video/audio/music generation).
 * Returns context with nodeType, provider, aspectRatio, duration from that node.
 * Returns null if no consumer found.
 */
export function inferPromptContext(
  nodeId: string,
  nodes: Array<{ id: string; type?: string; data: Record<string, unknown> }>,
  edges: Array<{ source: string; target: string }>,
): PromptContext | null {
  // Build adjacency list: source -> target[]
  const adj = new Map<string, string[]>()
  for (const edge of edges) {
    const list = adj.get(edge.source)
    if (list) list.push(edge.target)
    else adj.set(edge.source, [edge.target])
  }

  // Build node lookup
  const nodeMap = new Map(nodes.map((n) => [n.id, n]))

  // BFS
  const visited = new Set<string>([nodeId])
  const queue = adj.get(nodeId) ?? []
  for (const id of queue) visited.add(id)

  let head = 0
  while (head < queue.length) {
    const currentId = queue[head++]
    const node = nodeMap.get(currentId)
    if (!node?.type) continue

    if (hasPromptConsumerType(node.type)) {
      const data = node.data
      return {
        nodeType: node.type,
        provider: (data.provider as string) ?? undefined,
        aspectRatio: (data.aspectRatio as string) ?? undefined,
        duration: (data.duration as number) ?? undefined,
      }
    }

    // Enqueue children
    const children = adj.get(currentId) ?? []
    for (const childId of children) {
      if (!visited.has(childId)) {
        visited.add(childId)
        queue.push(childId)
      }
    }
  }

  return null
}
