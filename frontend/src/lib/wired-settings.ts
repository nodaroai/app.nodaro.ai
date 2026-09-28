import { SETTINGS_INPUT_CONSUMERS, resolveWiredSettings } from "@nodaro/shared"

interface GraphNode {
  readonly id: string
  readonly type?: string | null
  readonly data?: unknown
}

interface GraphEdge {
  readonly source: string
  readonly target: string
  readonly targetHandle?: string | null
}

/**
 * `node` as it runs, for pricing: a node with a Settings input carries the
 * wired Aspect Ratio / Duration / Provider — the resolution both run engines
 * apply — so the run button, the workflow total and the pre-run credit gate
 * price the model and length the run reserves. Without the graph (no edges,
 * nodes or id) the node is priced as stored.
 */
export function withWiredSettings<T extends { id?: string; type?: string | null; data?: unknown }>(
  node: T,
  edges?: ReadonlyArray<GraphEdge>,
  nodes?: ReadonlyArray<GraphNode>,
): T {
  const type = node.type ?? ""
  if (!edges || !nodes || !node.id || !SETTINGS_INPUT_CONSUMERS[type]) return node
  const { data } = resolveWiredSettings(node.id, type, (node.data ?? {}) as Record<string, unknown>, nodes, edges)
  return { ...node, data }
}
