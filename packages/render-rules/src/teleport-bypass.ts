/**
 * A Teleport pair is one wire with a jump in it: what leaves a Teleport Receive
 * is EXACTLY what entered the Teleport Send on its channel — the same node, the
 * same pip, so the same type, list, fan-out, JSON kind and media (decided
 * 2026-10-13). The store keeps a `data.teleporter` edge Send → Receive (hidden
 * on the canvas), so a pair, or a chain of pairs, is a plain path of edges.
 *
 * Every rule that reads a wire's source (connection rules, fan-out, list
 * columns, edge modes, output extraction, payload building) is written for the
 * real producer. Rather than teach each one about teleports, the engines and
 * the canvas re-point a wire that leaves a teleport at its origin
 * (`bypassTeleports`) and every rule then sees the direct wire. The consumer
 * wire keeps its own id, target and data (its each/all mode included — the same
 * rule `preview-gate.ts` applies through a pair).
 *
 * Two rules come with it:
 *  - A SKIPPED teleport cuts the wire, as it always has (decided 2026-10-13): the
 *    bypass stops there, so the skip still reaches the node it feeds.
 *  - Per-wire settings saved on a consumer (Collect's order, reference order,
 *    audio track settings, …) are keyed by the node the wire was DRAWN from —
 *    the Receive. A re-pointed wire keeps that id in `teleportedFrom`; read it
 *    through `drawnSourceId`, never `edge.source`, wherever a setting is keyed
 *    by source id.
 */

export const TELEPORT_NODE_TYPES: ReadonlySet<string> = new Set(["teleport-send", "teleport-receive"])

export function isTeleportNodeType(nodeType: string | null | undefined): boolean {
  return nodeType != null && TELEPORT_NODE_TYPES.has(nodeType)
}

export interface TeleportOrigin {
  /** The first non-teleport node behind the pair (or chain of pairs). */
  readonly nodeId: string
  /** The pip that node's wire into the Send leaves from. */
  readonly sourceHandle: string | null
}

/** A wire as these rules read it (an estimate's may lack ends; such a wire is left as it is). */
export interface TeleportEdgeLike {
  readonly source?: string
  readonly target?: string
  readonly sourceHandle?: string | null
}

/**
 * The node (and its pip) feeding a teleport, through any chain of pairs.
 * `null` when `nodeId` is not a teleport, or when the chain ends without a
 * source (a Send with nothing wired in, a broken pair, a teleport cycle) — the
 * teleport is then judged by its own type, as before.
 */
export function resolveTeleportOrigin(
  nodeId: string,
  nodeTypeById: (id: string) => string | null | undefined,
  edges: readonly TeleportEdgeLike[],
  /** A teleport for which this is true ends the walk with no origin (a skipped one). */
  isCut?: (id: string) => boolean,
): TeleportOrigin | null {
  if (!isTeleportNodeType(nodeTypeById(nodeId))) return null
  const visited = new Set<string>()
  let current = nodeId
  while (isTeleportNodeType(nodeTypeById(current))) {
    if (visited.has(current) || isCut?.(current)) return null
    visited.add(current)
    const inEdge = edges.find((e) => e.target === current)
    if (!inEdge || inEdge.source === undefined) return null
    if (!isTeleportNodeType(nodeTypeById(inEdge.source))) {
      return { nodeId: inEdge.source, sourceHandle: inEdge.sourceHandle ?? null }
    }
    current = inEdge.source
  }
  return null
}

/** Where a re-pointed wire was drawn from on the canvas. */
export interface TeleportedFrom {
  readonly source: string
  readonly sourceHandle: string | null
}

/** Where `bypassTeleports` re-pointed this wire from, if it did. */
export function teleportedFromOf(edge: object): TeleportedFrom | undefined {
  return (edge as { readonly teleportedFrom?: TeleportedFrom }).teleportedFrom
}

/**
 * The id of the node a wire was DRAWN from: the Receive for a wire
 * `bypassTeleports` re-pointed, else its source. Per-wire settings saved on a
 * consumer are keyed by this id.
 */
export function drawnSourceId(edge: { readonly source: string }): string {
  return teleportedFromOf(edge)?.source ?? edge.source
}

/**
 * The graph with every wire that leaves a teleport re-pointed at the pair's
 * origin node and pip (`teleportedFrom` keeps where it was drawn from). Wires
 * INTO teleports are kept (the teleports still run as harmless pass-throughs
 * for their own display); a teleport with no origin, or behind a skipped
 * teleport, keeps its wires. Returns the input array itself when no wire
 * changes. Never write its result back to a stored graph.
 */
export function bypassTeleports<E extends TeleportEdgeLike>(
  nodes: ReadonlyArray<{ readonly id?: string; readonly type?: string | null; readonly data?: unknown }>,
  edges: readonly E[],
): E[] {
  const byId = new Map(nodes.flatMap((n) => (n.id === undefined ? [] : [[n.id, n] as const])))
  const typeOf = (id: string) => byId.get(id)?.type ?? undefined
  const isCut = (id: string) => {
    const data = byId.get(id)?.data
    return !!data && typeof data === "object" && (data as { skipped?: unknown }).skipped === true
  }
  let changed = false
  const out = edges.map((e) => {
    if (e.source === undefined || !isTeleportNodeType(typeOf(e.source)) || isTeleportNodeType(typeOf(e.target ?? ""))) return e
    const origin = resolveTeleportOrigin(e.source, typeOf, edges, isCut)
    if (!origin) return e
    changed = true
    const teleportedFrom: TeleportedFrom = { source: e.source, sourceHandle: e.sourceHandle ?? null }
    return { ...e, source: origin.nodeId, sourceHandle: origin.sourceHandle, teleportedFrom }
  })
  return changed ? out : (edges as E[])
}

/**
 * Settings a consumer saves per incoming wire (track settings, reference and
 * image order, audio offsets) are keyed by the node each wire was DRAWN from —
 * a Teleport Receive's id — while the run, reading the bypassed graph, names
 * the origin. These map the saved keys onto the run's ids, at the one place a
 * setting is read; the run's own ids never change (an id another node joins
 * on — Audio Sync's offsets against Edit Plan's sources — must stay the origin).
 *
 * `carriedWireAliases`: for each re-pointed wire into `consumerId`, the drawn
 * id → the origin id.
 */
export function carriedWireAliases(consumerId: string, edges: readonly TeleportEdgeLike[]): ReadonlyMap<string, string> {
  const aliases = new Map<string, string>()
  for (const e of edges) {
    if (e.target !== consumerId) continue
    const from = teleportedFromOf(e)
    if (from && e.source !== undefined && !aliases.has(from.source)) aliases.set(from.source, e.source)
  }
  return aliases
}

const WIRED_TILE = "wired:"

/** A saved id (a node id, or a `wired:<node id>` reference tile) in the run's terms. */
export function toCarriedId(id: string, aliases: ReadonlyMap<string, string>): string {
  if (aliases.size === 0) return id
  const direct = aliases.get(id)
  if (direct !== undefined) return direct
  if (id.startsWith(WIRED_TILE)) {
    const origin = aliases.get(id.slice(WIRED_TILE.length))
    if (origin !== undefined) return WIRED_TILE + origin
  }
  return id
}

/** A saved order in the run's terms (unchanged when no wire into the consumer was re-pointed). */
export function toCarriedIds<T extends readonly string[] | undefined>(ids: T, aliases: ReadonlyMap<string, string>): T {
  if (!ids || aliases.size === 0) return ids
  return ids.map((id) => toCarriedId(id, aliases)) as unknown as T
}

/**
 * A saved per-source record in the run's terms. A key the origin already has
 * (the same node also wired in directly) keeps its own value.
 */
export function toCarriedKeys<V>(record: Readonly<Record<string, V>> | undefined, aliases: ReadonlyMap<string, string>): Record<string, V> | undefined {
  if (!record || aliases.size === 0) return record as Record<string, V> | undefined
  const out: Record<string, V> = { ...record }
  for (const [drawn, origin] of aliases) {
    if (drawn in record && !(origin in record)) out[origin] = record[drawn]
  }
  return out
}

/*
 * The fields below are every per-wire setting a consumer saves, by its shape.
 * frontend/src/lib/__tests__/teleport-per-wire-fields.test.ts fails on a node
 * data field whose name says it holds wired node ids and that is listed in
 * none of them — a field missed here is silently lost through a pair.
 */

/** A consumer's settings saved as ORDERS (or sets) of the nodes wired into it (ids, or `wired:<id>` tiles). */
export const PER_WIRE_ORDER_FIELDS = [
  "order",
  "referenceOrder",
  "referenceImageOrder",
  "connectedRefImageOrder",
  "connectedImageOrder",
  "connectedMediaOrder",
  "imageOrder",
  "clipOrder",
  "sourceOrder",
  "trackOrder",
  "segmentOrder",
  "assetOrder",
  "excludeSourceIds",
] as const

/** A consumer's settings saved PER node wired into it, keyed by that node's id. */
export const PER_WIRE_KEYED_FIELDS = [
  "trackSettings",
  "audioOffsets",
  "trackVolumes",
  "segmentSettings",
  "imageSizeBySource",
  "imageLabelBySource",
  "referenceRoles",
  "referenceObjectIds",
  "sourceConfig",
] as const

/** A consumer's setting that names ONE node wired into it (the duck key, the selected start frame, …). */
export const PER_WIRE_ID_FIELDS = [
  "duckUnder",
  "reference",
  "selectedStartFrameNodeId",
  "selectedEndFrameNodeId",
  "selectedAudioNodeId",
  "selectedImageNodeId",
  "selectedVideoNodeId",
  "masterSourceId",
  "wideSourceId",
] as const

/** A consumer's settings saved as a list of entries, each naming a wired node in the given key. */
export const PER_WIRE_ENTRY_FIELDS: Readonly<Record<string, string>> = {
  assetInjections: "sourceNodeId",
}

/**
 * The node with its per-wire settings in the run's terms (see
 * `carriedWireAliases`). The same node object when no wire into it was
 * re-pointed. Applied where each engine builds a node's run — never stored.
 */
export function carriedNodeSettings<N extends { readonly id: string; readonly data?: unknown }>(
  node: N,
  edges: readonly TeleportEdgeLike[],
): N {
  const aliases = carriedWireAliases(node.id, edges)
  if (aliases.size === 0 || !node.data || typeof node.data !== "object") return node
  const data = node.data as Record<string, unknown>
  const next: Record<string, unknown> = { ...data }
  for (const field of PER_WIRE_ORDER_FIELDS) {
    const value = data[field]
    if (Array.isArray(value)) next[field] = value.map((id) => (typeof id === "string" ? toCarriedId(id, aliases) : id))
  }
  for (const field of PER_WIRE_KEYED_FIELDS) {
    const value = data[field]
    if (value && typeof value === "object" && !Array.isArray(value)) next[field] = toCarriedKeys(value as Record<string, unknown>, aliases)
  }
  for (const field of PER_WIRE_ID_FIELDS) {
    const value = data[field]
    if (typeof value === "string") next[field] = toCarriedId(value, aliases)
  }
  for (const [field, key] of Object.entries(PER_WIRE_ENTRY_FIELDS)) {
    const value = data[field]
    if (!Array.isArray(value)) continue
    next[field] = value.map((entry) => {
      if (!entry || typeof entry !== "object") return entry
      const id = (entry as Record<string, unknown>)[key]
      return typeof id === "string" ? { ...entry, [key]: toCarriedId(id, aliases) } : entry
    })
  }
  return { ...node, data: next }
}
