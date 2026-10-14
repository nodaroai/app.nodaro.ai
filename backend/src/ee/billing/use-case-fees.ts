/**
 * The per-run fees of the use-case nodes on a graph, as a quote counts them
 * (decided 2026-10-13): a node fed by a List (or any Each wire, or repeated)
 * runs once per item — each run its own wrapper and its own fee — so each fee
 * counts once per run the node makes (`nodeFanOut`), read on the graph as
 * saved (UNEXPANDED: the node itself, its own wires). Pure.
 */
import { nodeFanOut } from "@nodaro/render-rules"

type FeeNode = { readonly id?: string; readonly type: string; readonly data?: Record<string, unknown>; readonly parentId?: string | null }
type FeeEdge = { readonly source?: string; readonly target: string; readonly sourceHandle?: string | null; readonly targetHandle?: string | null; readonly data?: unknown }

export function usecaseFeesTotal(
  fees: ReadonlyArray<{ readonly nodeId: string; readonly creditId: string }>,
  /** One fee's credits (the price table's lookup). */
  feeOf: (creditId: string) => number,
  nodes: ReadonlyArray<FeeNode>,
  edges: ReadonlyArray<FeeEdge> | undefined,
  /** The nodes the priced run executes (a frozen node hands on what it holds). */
  rerunIds: ReadonlySet<string>,
): number {
  if (fees.length === 0) return 0
  const gateNodes = nodes.flatMap((n) => (n.id ? [{ id: n.id, type: n.type, data: n.data, parentId: n.parentId }] : []))
  const gateEdges = (edges ?? []).flatMap((e) =>
    e.source ? [{ source: e.source, target: e.target, sourceHandle: e.sourceHandle, targetHandle: e.targetHandle, data: e.data }] : [],
  )
  const byId = new Map(gateNodes.map((n) => [n.id, n] as const))
  return fees.reduce((total, f) => {
    const node = byId.get(f.nodeId)
    const runs = node ? nodeFanOut(node, gateNodes, gateEdges, rerunIds) : 1
    return total + runs * feeOf(f.creditId)
  }, 0)
}
