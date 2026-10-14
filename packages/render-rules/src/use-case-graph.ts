/**
 * The use-case graph contract (podcast use-case nodes, decided 2026-10-13):
 * what a builder emits (the chain of shipped nodes one use-case node stands
 * for), what the server stores on the hidden execution that runs it
 * (`StoredInlineGraph`, `workflow_executions.inline_graph`), and the identity a
 * continuation compares (`hash`). Pure; no I/O.
 */
import { ancestorsOf } from "./graph-walk"

export const USE_CASE_NODE_TYPES = ["tighten-episode"] as const
export type UseCaseNodeType = (typeof USE_CASE_NODE_TYPES)[number]

export function isUseCaseNodeType(type: string | null | undefined): type is UseCaseNodeType {
  return typeof type === "string" && (USE_CASE_NODE_TYPES as readonly string[]).includes(type)
}

export type UseCaseFeeCreditId = `use-case-fee:${UseCaseNodeType}`

/** The `model_pricing` id of a use-case node's per-run fee (migration 509). */
export function usecaseFeeCreditId(type: UseCaseNodeType): UseCaseFeeCreditId {
  return `use-case-fee:${type}`
}

/** The static mirror of the fee (STATIC_CREDIT_COSTS / the editor's fallback table). */
export const USE_CASE_FEE_STATIC_CREDITS = 10

export interface UseCaseGraphNode {
  readonly id: string
  readonly type: string
  readonly position: { readonly x: number; readonly y: number }
  readonly data: Readonly<Record<string, unknown>>
}
export interface UseCaseGraphEdge {
  readonly id: string
  readonly source: string
  readonly target: string
  readonly sourceHandle: string
  readonly targetHandle: string
}
export interface UseCaseHandleRef {
  readonly nodeId: string
  readonly handle: string
}
/** Which inner node/handle feeds each wrapper output, and the plan/render the review and Render final address. */
export interface UseCaseOutputMap {
  readonly media: UseCaseHandleRef
  /** The render's own media: what a review-on run delivers (its preview) and what consumers read until Render final. */
  readonly preview: UseCaseHandleRef
  readonly json: UseCaseHandleRef
  readonly transcript: UseCaseHandleRef
  readonly planNodeId: string
  readonly renderNodeId: string
}
export interface UseCaseGraph {
  readonly nodeType: UseCaseNodeType
  readonly nodes: readonly UseCaseGraphNode[]
  readonly edges: readonly UseCaseGraphEdge[]
  readonly outputMap: UseCaseOutputMap
}
/** What `workflow_executions.inline_graph` holds. */
export interface StoredInlineGraph extends UseCaseGraph {
  readonly version: 1
  /** The resolved settings the graph was built from: what the run was asked for (review, support). Not in `hash`. */
  readonly settings: Readonly<Record<string, unknown>>
  /** `usecaseGraphHash` of the graph alone. */
  readonly hash: string
}

function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null"
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`
  const record = value as Record<string, unknown>
  const entries = Object.keys(record)
    .filter((k) => record[k] !== undefined)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${canonical(record[k])}`)
  return `{${entries.join(",")}}`
}

/** FNV-1a 32-bit with a chosen offset basis — two bases give a 64-bit identity without BigInt. */
function fnv1a32(text: string, seed: number): number {
  let h = seed >>> 0
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h >>> 0
}

/**
 * The graph's identity: 16 hex chars over its canonical JSON (nodeType, nodes,
 * edges, outputMap; key order and `undefined` keys never matter). Everything
 * a run does is in the graph, so the settings it was built from are not
 * hashed: two settings that build the same graph are the same run.
 */
export function usecaseGraphHash(graph: UseCaseGraph): string {
  const text = canonical({ nodeType: graph.nodeType, nodes: graph.nodes, edges: graph.edges, outputMap: graph.outputMap })
  const hex = (n: number) => n.toString(16).padStart(8, "0")
  return `${hex(fnv1a32(text, 0x811c9dc5))}${hex(fnv1a32(text, 0x050c5d1f))}`
}

/**
 * The nodes a use-case run executes first (decided 2026-10-13). With the
 * render at proxy (review on): only the chain up to and including the render
 * — what follows it (captions, music, merge) stays in the snapshot (so the
 * hash is unchanged) and runs once, in Render final, whatever the
 * preview-stop-rule flag says. Null when the render is final: the whole
 * graph. In the graph's node order.
 */
export function initialRunNodeIds(graph: UseCaseGraph): string[] | null {
  const render = graph.nodes.find((n) => n.id === graph.outputMap.renderNodeId)
  if (!render || render.data.quality !== "proxy") return null
  const keep = ancestorsOf(render.id, graph.edges)
  keep.add(render.id)
  return graph.nodes.filter((n) => keep.has(n.id)).map((n) => n.id)
}

/** A deep copy of plain JSON data: the snapshot shares nothing with the graph or settings it was made from. */
function cloneJson<T>(value: T): T {
  if (value === null || typeof value !== "object") return value
  if (Array.isArray(value)) return value.map(cloneJson) as T
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (v !== undefined) out[k] = cloneJson(v)
  }
  return out as T
}

/**
 * The snapshot the server stores for a use-case run: the graph, the resolved
 * settings it was built from (any builder's settings — the contract does not
 * know their shape), and the graph's hash. Fresh objects throughout.
 */
export function toStoredInlineGraph(graph: UseCaseGraph, settings: object): StoredInlineGraph {
  return {
    version: 1,
    nodeType: graph.nodeType,
    nodes: cloneJson(graph.nodes),
    edges: cloneJson(graph.edges),
    outputMap: cloneJson(graph.outputMap),
    settings: cloneJson(settings) as Readonly<Record<string, unknown>>,
    hash: usecaseGraphHash(graph),
  }
}

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v)
const isHandleRef = (v: unknown): boolean => isRecord(v) && typeof v.nodeId === "string" && typeof v.handle === "string"

/**
 * Whether a stored value is a use-case snapshot (what `inline_graph` holds for
 * a use-case run). False for anything else, including the `{}` an expunged
 * ordinary execution may hold.
 */
export function isStoredInlineGraph(value: unknown): value is StoredInlineGraph {
  if (!isRecord(value)) return false
  const { outputMap } = value
  return (
    value.version === 1 &&
    isUseCaseNodeType(value.nodeType as string) &&
    typeof value.hash === "string" &&
    isRecord(value.settings) &&
    Array.isArray(value.nodes) &&
    value.nodes.every((n) => isRecord(n) && typeof n.id === "string" && typeof n.type === "string" && isRecord(n.data)) &&
    Array.isArray(value.edges) &&
    value.edges.every(
      (e) =>
        isRecord(e) &&
        typeof e.id === "string" &&
        typeof e.source === "string" &&
        typeof e.target === "string" &&
        typeof e.sourceHandle === "string" &&
        typeof e.targetHandle === "string",
    ) &&
    isRecord(outputMap) &&
    isHandleRef(outputMap.media) &&
    isHandleRef(outputMap.preview) &&
    isHandleRef(outputMap.json) &&
    isHandleRef(outputMap.transcript) &&
    typeof outputMap.planNodeId === "string" &&
    typeof outputMap.renderNodeId === "string"
  )
}
