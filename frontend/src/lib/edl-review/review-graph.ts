/**
 * The part of the canvas a review reads, and when it has changed (§2.1 of the
 * inspectors design). Everything the review inspector derives from the canvas
 * (the plan, the transcript, the render's sources, the render rule's verdict,
 * the take's freshness) reads the render and what feeds it, never what lies
 * downstream or beside it. And none of it reads run state: a job's status,
 * progress or in-flight markers (`TRANSIENT_RUNTIME_KEYS`) are never saved and
 * never part of a render.
 *
 * So the review keeps the canvas snapshot it last read until something it
 * reads changes: the edges, or a non-transient data value of a node upstream
 * of the render. A run's ticks, a drag, and an edit to a node the render does
 * not read leave it alone. The lock (R9 a) is the one thing that reads run
 * state, and it reads the live store.
 */
import { TRANSIENT_RUNTIME_KEYS } from "@nodaro/shared"

export interface ReviewGraphNode {
  readonly id: string
  readonly type?: string
  readonly data?: unknown
}
export interface ReviewGraphEdge {
  readonly source: string
  readonly target: string
}

export interface ReviewGraph<N extends ReviewGraphNode = ReviewGraphNode, E extends ReviewGraphEdge = ReviewGraphEdge> {
  readonly nodes: readonly N[]
  readonly edges: readonly E[]
}

/** The data keys a comparison skips on one node; run state by default. */
export type IgnoredKeys = (nodeId: string) => ReadonlySet<string>

export const runStateKeys: IgnoredKeys = () => TRANSIENT_RUNTIME_KEYS

/** `rootId` and every node upstream of it, through any wire. */
export function upstreamClosure(rootId: string, edges: readonly ReviewGraphEdge[]): Set<string> {
  const into = new Map<string, string[]>()
  for (const e of edges) {
    const list = into.get(e.target)
    if (list) list.push(e.source)
    else into.set(e.target, [e.source])
  }
  const seen = new Set<string>([rootId])
  const queue = [rootId]
  while (queue.length > 0) {
    for (const source of into.get(queue.pop()!) ?? []) {
      if (seen.has(source)) continue
      seen.add(source)
      queue.push(source)
    }
  }
  return seen
}

function sameData(a: unknown, b: unknown, ignored: ReadonlySet<string>): boolean {
  if (a === b) return true
  if (!a || !b || typeof a !== "object" || typeof b !== "object") return false
  const da = a as Record<string, unknown>
  const db = b as Record<string, unknown>
  for (const key in da) if (!ignored.has(key) && !Object.is(da[key], db[key])) return false
  for (const key in db) if (!ignored.has(key) && !(key in da) && db[key] !== undefined) return false
  return true
}

/**
 * Whether `next` holds what `prev` held for a review of `rootId`: the same
 * edges, and the same type and data (bar `ignored` keys) on every node
 * upstream of it.
 */
export function sameReviewGraph(prev: ReviewGraph, next: ReviewGraph, rootId: string, ignored: IgnoredKeys = runStateKeys): boolean {
  if (prev.nodes === next.nodes && prev.edges === next.edges) return true
  if (prev.edges !== next.edges) return false
  const ids = upstreamClosure(rootId, next.edges)
  const before = new Map<string, ReviewGraphNode>()
  for (const n of prev.nodes) if (ids.has(n.id)) before.set(n.id, n)
  let found = 0
  for (const n of next.nodes) {
    if (!ids.has(n.id)) continue
    found++
    const old = before.get(n.id)
    if (!old) return false
    if (old === n) continue
    if (old.type !== n.type || !sameData(old.data, n.data, ignored(n.id))) return false
  }
  return found === before.size
}

/** A cache for one review graph: `next` unless it holds what the cached one did. */
export function stableReviewGraph<G extends ReviewGraph>(
  cache: { current: G | null },
  next: G,
  rootId: string,
  ignored: IgnoredKeys = runStateKeys,
): G {
  const prev = cache.current
  if (prev && sameReviewGraph(prev, next, rootId, ignored)) return prev
  cache.current = next
  return next
}
