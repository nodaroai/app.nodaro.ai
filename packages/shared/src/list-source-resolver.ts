/**
 * Follow a list node's `in` edge chain to its effective upstream source.
 *
 * When a `list` node has no manual rows but an incoming connection, the UI
 * renders its upstream's items (see list-node.tsx's `connectedItems ??
 * staticItems`). Without this helper, downstream readers would see an empty
 * list because `extractSourceNodeOutput` for `list` only reads `data.rows`.
 *
 * Shared between the frontend DAG executor (`node-input-resolver.ts`) and
 * the backend orchestrator (`inline-executor.ts`) so both paths resolve
 * list-connected-mode identically.
 */

type EdgeShape = {
  source: string
  target: string
  sourceHandle?: string | null
  targetHandle?: string | null
}

type NodeShape = {
  id: string
  type?: string
  data: Record<string, unknown>
}

function hasAnyRow(rows: string[][]): boolean {
  return rows.some((r) => r.some((v) => v?.trim()))
}

export function resolveSourceThroughConnectedList<
  E extends EdgeShape,
  N extends NodeShape,
>(edge: E, nodes: ReadonlyArray<N>, edges: ReadonlyArray<E>): E {
  const visited = new Set<string>()
  let current = edge
  while (true) {
    const src = nodes.find((n) => n.id === current.source)
    if (!src || src.type !== "list") return current
    if (visited.has(src.id)) return current
    visited.add(src.id)
    const rows = (src.data.rows as string[][] | undefined) ?? []
    if (hasAnyRow(rows)) return current
    const inEdge = edges.find(
      (e) => e.target === src.id && e.targetHandle === "in",
    )
    if (!inEdge) return current
    current = inEdge
  }
}
