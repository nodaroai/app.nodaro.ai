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

import type { WorkflowNode, WorkflowEdge, GeneratedResult } from "@/types/nodes"
import { TRANSIENT_RUNTIME_KEYS, EXECUTION_DATA_KEYS } from "@nodaro/shared"

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

  // Reference fast-path (the store is immutable, so an unchanged node keeps its
  // identity). When the reference DID change, only treat it as an upsert if the
  // content changed beyond transient run-state — otherwise a purely transient
  // flip (e.g. the Execute-All optimistic executionStatus) would drag a possibly
  // stale node into the delta and a conflict rebase. `generatedResults` is NOT
  // transient, so genuine result additions still upsert.
  const upsertNodes = current.nodes.filter((n) => {
    const s = snapNodesById.get(n.id)
    if (s === n) return false
    if (!s) return true
    return !equalIgnoringTransient(n, s)
  })
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
    // Local wins config, but never lose results: a contested node's
    // generatedResults are union'd with the fresh remote's (see
    // mergeNodePreservingResults). This is the data-loss guard.
    .map((n) => {
      const u = upsertNodesById.get(n.id)
      return u ? mergeNodePreservingResults(n, u) : n
    })
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
    // Compare CONFIG only — ignore result/transient fields. Layer A unions
    // results so a result-only remote change is never lost; the "your edits
    // won" toast should fire for genuine config conflicts only.
    return !deepEqual(configOnly(remote), configOnly(base))
  })
}

/** Recursive, order-insensitive deep-equal. NOT JSON.stringify — node.data is
 *  built via `{...data, x}` spreads, so key order is unstable. */
export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false
    return a.every((v, i) => deepEqual(v, b[i]))
  }
  const ao = a as Record<string, unknown>
  const bo = b as Record<string, unknown>
  const ak = Object.keys(ao)
  const bk = Object.keys(bo)
  if (ak.length !== bk.length) return false
  return ak.every((k) => Object.prototype.hasOwnProperty.call(bo, k) && deepEqual(ao[k], bo[k]))
}

function omitKeys(node: WorkflowNode, keys: ReadonlySet<string>): unknown {
  const { data, ...rest } = node as Record<string, unknown> & { data?: Record<string, unknown> }
  const cleaned: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(data ?? {})) if (!keys.has(k)) cleaned[k] = v
  return { ...rest, data: cleaned }
}

/** Equal once transient run-state (executionStatus, currentJobId, progress, …)
 *  is ignored. `generatedResults` is NOT transient, so result changes count. */
export function equalIgnoringTransient(a: WorkflowNode, b: WorkflowNode): boolean {
  return deepEqual(omitKeys(a, TRANSIENT_RUNTIME_KEYS), omitKeys(b, TRANSIENT_RUNTIME_KEYS))
}

/** A node with all result + transient (EXECUTION_DATA_KEYS) fields removed —
 *  the user-authored config surface used for contested-conflict detection. */
function configOnly(node: WorkflowNode): unknown {
  return omitKeys(node, EXECUTION_DATA_KEYS)
}

/** Union two result lists, deduped by `url` (the asset identity — synthetic
 *  `exec-<nodeId>` jobIds collide), falling back to `jobId` for the rare
 *  url-less entry (so it's never silently dropped). Sorted newest-first by
 *  `timestamp`. */
function mergeResultsByUrl(remote: GeneratedResult[], local: GeneratedResult[]): GeneratedResult[] {
  const byKey = new Map<string, GeneratedResult>()
  for (const r of [...remote, ...local]) {
    const key = r?.url || r?.jobId
    if (key && !byKey.has(key)) byKey.set(key, r)
  }
  return [...byKey.values()].sort((x, y) => (y.timestamp ?? "").localeCompare(x.timestamp ?? ""))
}

/**
 * Merge a fresh REMOTE node with the LOCAL upsert during a conflict rebase:
 * local wins every field EXCEPT `generatedResults` (union'd so neither side's
 * generations are lost) and `activeResultIndex` (follows the local active
 * result's URL into the merged array). No-op (returns local) when neither side
 * has results — preserves identity for the common non-result case.
 */
export function mergeNodePreservingResults(remote: WorkflowNode, local: WorkflowNode): WorkflowNode {
  const rd = (remote.data ?? {}) as Record<string, unknown>
  const ld = (local.data ?? {}) as Record<string, unknown>
  const rRes = (rd.generatedResults as GeneratedResult[] | undefined) ?? []
  const lRes = (ld.generatedResults as GeneratedResult[] | undefined) ?? []
  if (rRes.length === 0 && lRes.length === 0) return local
  const merged = mergeResultsByUrl(rRes, lRes)
  const activeUrl = lRes[(ld.activeResultIndex as number) ?? 0]?.url
  const idx = activeUrl ? merged.findIndex((r) => r.url === activeUrl) : -1
  return {
    ...local,
    data: { ...ld, generatedResults: merged, activeResultIndex: idx >= 0 ? idx : 0 } as typeof local.data,
  }
}
