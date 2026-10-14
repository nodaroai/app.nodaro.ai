/**
 * The one pair of plain wire walks over a graph: every node upstream of a
 * node, and every node downstream of it. Wires only — no Group membership,
 * no field mappings (the stop rule's own "feeds" is `buildFeedMaps` in
 * `@nodaro/shared`). Shared by the Speaker View source check, a use-case
 * run's first subset (`initialRunNodeIds`) and the app lane's continuation,
 * so none of them keeps a fixpoint loop of its own. Pure.
 */

/** A wire as the walks read it: either engine's edge fits. */
export type WalkEdge = { readonly source: string; readonly target: string }

function walk(start: string, next: ReadonlyMap<string, readonly string[]>): Set<string> {
  const seen = new Set<string>()
  const stack = [start]
  while (stack.length > 0) {
    for (const id of next.get(stack.pop()!) ?? []) {
      if (seen.has(id)) continue
      seen.add(id)
      stack.push(id)
    }
  }
  return seen
}

function index(edges: ReadonlyArray<WalkEdge>, from: "source" | "target", to: "source" | "target"): Map<string, string[]> {
  const out = new Map<string, string[]>()
  for (const e of edges) {
    const list = out.get(e[from])
    if (list) list.push(e[to])
    else out.set(e[from], [e[to]])
  }
  return out
}

/** Every node with a path to `id`, `id` not included. */
export function ancestorsOf(id: string, edges: ReadonlyArray<WalkEdge>): Set<string> {
  return walk(id, index(edges, "target", "source"))
}

/** Every node with a path from `id`, `id` not included. */
export function descendantsOf(id: string, edges: ReadonlyArray<WalkEdge>): Set<string> {
  return walk(id, index(edges, "source", "target"))
}
