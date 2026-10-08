/**
 * A node's id where the published app names it — its input and output items,
 * its card, its display mode, whether it is hidden — renamed when the node is
 * swapped for another (`lib/replace-render-node.ts`, decided 2026-10-08), and
 * followed back and forth by Undo and Redo.
 *
 * The app's settings are not part of an undo step (a presentation edit is not
 * undoable), so a swap records which id became which (`nodeIdMoves` on the
 * workflow store) and every snapshot restore re-points the items at whichever
 * id of that chain is on the canvas again: Undo brings them back to the old
 * node with it, Redo moves them to the new one again, and a presentation edit
 * made in between is never taken back.
 */
import type { PresentationItem } from "@nodaro/shared"

/** `value` with every string equal to `from`, and every key equal to it,
 *  renamed to `to` — the same object when nothing changed. */
export function renameNodeId(value: unknown, from: string, to: string): unknown {
  if (value === from) return to
  if (Array.isArray(value)) {
    let changed = false
    const next = value.map((v) => {
      const r = renameNodeId(v, from, to)
      if (r !== v) changed = true
      return r
    })
    return changed ? next : value
  }
  if (value && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) {
    let changed = false
    const next: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value)) {
      const key = k === from ? to : k
      const r = renameNodeId(v, from, to)
      if (key !== k || r !== v) changed = true
      next[key] = r
    }
    return changed ? next : value
  }
  return value
}

/** One swap: the id that was replaced, and the id that replaced it. */
export type NodeIdMove = readonly [from: string, to: string]

/**
 * `settings` with each swap chain's ids re-pointed at the one member that is on
 * the canvas (`nodeIds`) — the same object when nothing changed, and a chain
 * with no member on the canvas (its node deleted) is left as it is.
 */
export function followNodeIdMoves<T>(settings: T, nodeIds: ReadonlySet<string>, moves: readonly NodeIdMove[]): T {
  if (moves.length === 0) return settings
  // Union-find over the swaps: each chain of ids is one class.
  const parent = new Map<string, string>()
  const find = (id: string): string => {
    let root = id
    while (parent.has(root) && parent.get(root) !== root) root = parent.get(root)!
    return root
  }
  for (const [from, to] of moves) {
    if (!parent.has(from)) parent.set(from, from)
    if (!parent.has(to)) parent.set(to, to)
    const a = find(from)
    const b = find(to)
    if (a !== b) parent.set(a, b)
  }
  const classes = new Map<string, string[]>()
  for (const id of parent.keys()) {
    const root = find(id)
    classes.set(root, [...(classes.get(root) ?? []), id])
  }
  let next: unknown = settings
  for (const members of classes.values()) {
    const present = members.filter((id) => nodeIds.has(id))
    if (present.length !== 1) continue
    for (const id of members) if (id !== present[0]) next = renameNodeId(next, id, present[0]!)
  }
  return next as T
}

/** One app item that names a node, as the swap's confirm lists it. */
export interface AppItemNaming {
  readonly section: "input" | "output"
  readonly kind: "node" | "field" | "output"
  /** The field or output it shows; absent for the whole node. */
  readonly key?: string
}

type ItemsSettings = {
  readonly inputItems?: readonly PresentationItem[]
  readonly outputItems?: readonly PresentationItem[]
}

const flat = (items: readonly PresentationItem[] | undefined): PresentationItem[] =>
  (items ?? []).flatMap((i) => (i.type === "group" ? flat(i.items) : [i]))

/** The app's input and output items that name `nodeId`, in order. */
export function appItemsNaming(settings: ItemsSettings | undefined, nodeId: string): AppItemNaming[] {
  const out: AppItemNaming[] = []
  for (const section of ["input", "output"] as const) {
    for (const item of flat(section === "input" ? settings?.inputItems : settings?.outputItems)) {
      if (item.type === "node" && item.nodeId === nodeId) out.push({ section, kind: "node" })
      else if (item.type === "field" && item.nodeId === nodeId) out.push({ section, kind: "field", key: item.field })
      else if (item.type === "output" && item.nodeId === nodeId) out.push({ section, kind: "output", key: item.outputKey })
    }
  }
  return out
}
