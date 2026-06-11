/**
 ***REDACTED-OSS-SCRUB***
 *
 * Changed-detection is REFERENCE diffing against the last-saved snapshot: the
 * workflow store never mutates nodes/edges (repo invariant — always copy), so
 * `current !== snapshot.byId[id]` is a correct O(n) dirty check with zero
 * bookkeeping across the store's many `isDirty` writers. Over-inclusion (a
 * writer that produced a new-but-equal object) is harmless: the node is
 * re-upserted with identical content.
 */

import type { WorkflowNode, WorkflowEdge } from "@/types/nodes"

/** References (NOT copies) to the graph handed to the last successful
 *  save / load / remote-reconcile — the base the next delta diffs against. */
export interface WorkflowGraphSnapshot {
  readonly nodes: ReadonlyArray<WorkflowNode>
  readonly edges: ReadonlyArray<WorkflowEdge>
}

export interface WorkflowDelta {
  readonly upsertNodes: WorkflowNode[]
  readonly deleteNodeIds: string[]
  readonly upsertEdges: WorkflowEdge[]
  readonly deleteEdgeIds: string[]
  /** Changed-node share of the larger graph — the full-save fallback gate. */
  readonly nodeChangeRatio: number
  readonly isEmpty: boolean
}

export function buildWorkflowDelta(
  current: WorkflowGraphSnapshot,
  snapshot: WorkflowGraphSnapshot,
): WorkflowDelta {
  const snapNodesById = new Map(snapshot.nodes.map((n) => [n.id, n]))
  const snapEdgesById = new Map(snapshot.edges.map((e) => [e.id, e]))
  const currentNodeIds = new Set(current.nodes.map((n) => n.id))
  const currentEdgeIds = new Set(current.edges.map((e) => e.id))

  const upsertNodes = current.nodes.filter((n) => snapNodesById.get(n.id) !== n)
  const deleteNodeIds = snapshot.nodes.filter((n) => !currentNodeIds.has(n.id)).map((n) => n.id)
  const upsertEdges = current.edges.filter((e) => snapEdgesById.get(e.id) !== e)
  const deleteEdgeIds = snapshot.edges.filter((e) => !currentEdgeIds.has(e.id)).map((e) => e.id)

  const denominator = Math.max(current.nodes.length, snapshot.nodes.length, 1)
  return {
    upsertNodes,
    deleteNodeIds,
    upsertEdges,
    deleteEdgeIds,
    nodeChangeRatio: (upsertNodes.length + deleteNodeIds.length) / denominator,
    isEmpty:
      upsertNodes.length === 0 &&
      deleteNodeIds.length === 0 &&
      upsertEdges.length === 0 &&
      deleteEdgeIds.length === 0,
  }
}

/**
 * Rebase merge: apply a local delta on top of a freshly fetched remote graph.
 * Upserts replace in place / append at the end (matching the RPC's order
 * semantics); deletions drop ids. Used after a CAS conflict so disjoint
 * writers converge without losing either side.
 */
export function applyDeltaToGraph(
  base: WorkflowGraphSnapshot,
  delta: Pick<WorkflowDelta, "upsertNodes" | "deleteNodeIds" | "upsertEdges" | "deleteEdgeIds">,
): { nodes: WorkflowNode[]; edges: WorkflowEdge[] } {
  const upsertNodesById = new Map(delta.upsertNodes.map((n) => [n.id, n]))
  const deleteNodeIds = new Set(delta.deleteNodeIds)
  const baseNodeIds = new Set(base.nodes.map((n) => n.id))
  const nodes = base.nodes
    .filter((n) => !deleteNodeIds.has(n.id))
    .map((n) => upsertNodesById.get(n.id) ?? n)
    .concat(delta.upsertNodes.filter((n) => !baseNodeIds.has(n.id)))

  const upsertEdgesById = new Map(delta.upsertEdges.map((e) => [e.id, e]))
  const deleteEdgeIds = new Set(delta.deleteEdgeIds)
  const baseEdgeIds = new Set(base.edges.map((e) => e.id))
  const edges = base.edges
    .filter((e) => !deleteEdgeIds.has(e.id))
    .map((e) => upsertEdgesById.get(e.id) ?? e)
    .concat(delta.upsertEdges.filter((e) => !baseEdgeIds.has(e.id)))

  return { nodes, edges }
}

/**
 * Contested ids: nodes the LOCAL delta upserts whose REMOTE copy also moved
 * since the shared snapshot (content compare — the fresh fetch has new object
 * identities, so reference equality can't apply here). Local wins per spec;
 * callers surface these labels in a toast so the override is never silent.
 */
export function findContestedNodes(
  delta: Pick<WorkflowDelta, "upsertNodes">,
  snapshot: WorkflowGraphSnapshot,
  fresh: WorkflowGraphSnapshot,
): WorkflowNode[] {
  const snapById = new Map(snapshot.nodes.map((n) => [n.id, n]))
  const freshById = new Map(fresh.nodes.map((n) => [n.id, n]))
  return delta.upsertNodes.filter((local) => {
    const remote = freshById.get(local.id)
    if (!remote) return false // deleted remotely — upsert re-creates, by design
    const base = snapById.get(local.id)
    if (!base) return false // we created it; remote copy implies our own echo
    return JSON.stringify(remote) !== JSON.stringify(base)
  })
}
