/**
 * Primitive "fingerprint" strings over a node's upstream graph context.
 *
 * Node components derive these inside a `useWorkflowStore(useShallow(...))`
 * selector so the component re-renders only when the relevant upstream state
 * changes — instead of holding a whole-`nodes`/`edges` subscription that
 * re-renders on every unrelated store mutation. The heavy resolution then reads
 * live arrays via `useWorkflowStore.getState()`, keyed on the fingerprint.
 *
 * These centralize the (fiddly, separator-sensitive) serialization that was
 * hand-copied across several node files. Separator bytes (\x01–\x04) only need
 * to be internally consistent; they are not part of any external contract.
 */

/** Minimal structural shapes — avoids coupling to the full node/edge types. */
type FpNode = { readonly id: string; readonly type?: string; readonly data?: unknown }
type FpEdge = {
  readonly id: string
  readonly source: string
  readonly target: string
  readonly sourceHandle?: string | null
  readonly targetHandle?: string | null
  readonly data?: unknown
}

/**
 * Fingerprint of the nodes directly feeding `id` via an incoming edge.
 * `mode: "data"` serializes each source's full `data` (use when the consumer
 * reads arbitrary source fields, e.g. result URLs/thumbnails); `mode: "label"`
 * captures only id/type/label (use when only identity + label matter).
 */
export function incomingSourcesFingerprint(
  nodes: ReadonlyArray<FpNode>,
  edges: ReadonlyArray<FpEdge>,
  id: string,
  mode: "data" | "label" = "data",
): string {
  // Index nodes by id once (O(V)) instead of `nodes.find()` per matching edge
  // (was O(deg·V)). Output is byte-for-byte identical — only the lookup changes.
  const nodesById = new Map<string, FpNode>()
  for (const n of nodes) nodesById.set(n.id, n)

  let fp = ""
  for (const e of edges) {
    if (e.target !== id) continue
    const src = nodesById.get(e.source)
    if (!src) continue
    if (mode === "label") {
      const label = ((src.data as Record<string, unknown> | undefined)?.label as string) ?? src.type ?? ""
      fp += `${e.id}\x01${src.id}\x01${src.type ?? ""}\x01${label}\x02`
    } else {
      fp += `${e.id}\x01${src.id}\x01${src.type ?? ""}\x01${JSON.stringify(src.data ?? {})}\x02`
    }
  }
  return fp
}

/**
 * Fingerprint of the transitive ancestor subgraph reachable from `seedSources`
 * (the nodes feeding `rootId`), including every ancestor node's `data` and the
 * edges among them. Used by list/loop nodes whose value resolution recurses up
 * a chain (`resolveLoopColumnValues`) — any deep-chain change invalidates the
 * memo without enumerating which field matters. `seedPrefix` is prepended (it
 * encodes the seeding edges, whose format differs per caller).
 */
export function upstreamSubgraphFingerprint(
  nodes: ReadonlyArray<FpNode>,
  edges: ReadonlyArray<FpEdge>,
  rootId: string,
  seedSources: ReadonlyArray<string>,
  seedPrefix: string,
): string {
  const visited = new Set<string>([rootId])
  const queue: string[] = [...seedSources]
  let fp = seedPrefix
  while (queue.length > 0) {
    const cur = queue.shift()!
    if (visited.has(cur)) continue
    visited.add(cur)
    const n = nodes.find((nn) => nn.id === cur)
    if (n) fp += `${n.id}\x01${n.type ?? ""}\x01${JSON.stringify(n.data ?? {})}\x02`
    for (const e of edges) {
      if (e.target === cur && !visited.has(e.source)) {
        queue.push(e.source)
        fp += `e:${e.id}\x01${e.source}\x01${e.sourceHandle ?? ""}\x01${e.targetHandle ?? ""}\x01${JSON.stringify(e.data ?? {})}\x04`
      }
    }
  }
  return fp
}
