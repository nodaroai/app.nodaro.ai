/**
 * The graphs a run reaches THROUGH a component node — each component's
 * published snapshot, and every graph it references in turn — for the
 * orchestrator's run-start check of an unpriced metered LLM model (R51).
 *
 * A component runs as its own execution, which refuses such a model at its
 * own start. By then every node of the PARENT run upstream of the component
 * has run and charged. So the parent asks first: the snapshots are read
 * through the same composed-graph loader publishing uses
 * (`loadUgcComposedGraph`: `/v1/component/execute`'s own lookup of a
 * component, owner-scoped sub-workflows inside it). Graphs reached only
 * through sub-workflow nodes are not returned: the run's own loader reads
 * those (`loadNestedRunGraphs`).
 *
 * Nothing is read for a run with no component or sub-workflow node.
 */
import { ugcComposedKey, ugcComposedPath } from "@nodaro/render-rules"
import { loadUgcComposedGraph } from "./ugc-composed-graph.js"

type GraphNode = { id: string; type: string; data?: unknown; parentId?: string | null }
type GraphEdge = { source: string; target: string; sourceHandle?: string | null; targetHandle?: string | null }

/** A graph reached through a component: its nodes and edges, and the chain of node ids that leads to it. */
export interface ComponentRunGraph {
  readonly nodes: ReadonlyArray<GraphNode>
  readonly edges: ReadonlyArray<GraphEdge>
  readonly path: readonly string[]
}

export async function componentRunGraphs(
  runNodes: ReadonlyArray<GraphNode>,
  edges: ReadonlyArray<GraphEdge>,
  ownerId: string,
): Promise<ComponentRunGraph[]> {
  if (!runNodes.some((n) => n.type === "component" || n.type === "sub-workflow")) return []
  const read = await loadUgcComposedGraph(runNodes as never, edges as never, ownerId)
  const typeAt = (path: readonly string[], i: number): string | undefined => {
    const parent = read.graph.get(ugcComposedKey(path.slice(0, i)))
    const node = parent?.nodes.find((n) => (n as { id?: unknown }).id === path[i])
    return node && typeof (node as { type?: unknown }).type === "string" ? ((node as { type: string }).type) : undefined
  }
  const out: ComponentRunGraph[] = []
  for (const [key, part] of read.graph) {
    const path = ugcComposedPath(key)
    if (path.length === 0) continue
    if (!path.some((_, i) => typeAt(path, i) === "component")) continue
    out.push({ nodes: part.nodes as ReadonlyArray<GraphNode>, edges: part.edges as ReadonlyArray<GraphEdge>, path })
  }
  return out
}
