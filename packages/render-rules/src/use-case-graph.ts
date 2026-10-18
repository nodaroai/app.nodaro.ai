/**
 * The use-case graph contract (podcast use-case nodes, decided 2026-10-13):
 * what a builder emits (the chain of shipped nodes one use-case node stands
 * for), what the server stores on the hidden execution that runs it
 * (`StoredInlineGraph`, `workflow_executions.inline_graph`), and the identity a
 * continuation compares (`hash`). Pure; no I/O.
 */
import type { EditPlanTier } from "@nodaro/shared/edl"
import { USE_CASE_NODE_TYPES, isUseCaseNodeType, type UseCaseNodeType } from "@nodaro/shared/nodes"
import { ancestorsOf } from "./graph-walk"

// The use-case node types are @nodaro/shared's one list (hand-registered ∪ the
// node units of execution.kind "use-case"); re-exported so every reader of
// this package keeps its import.
export { USE_CASE_NODE_TYPES, isUseCaseNodeType, type UseCaseNodeType }

/**
 * The use-case type of a run, read from its job row: the type its input
 * records (`input_data.type`), else its `job_type` (a row written before the
 * input recorded it). A recorded type wins even when it names no use-case
 * node. `null` when the row is not a run of a use-case node. One reading for
 * every surface that resolves a run's type (the continue route, the MCP verb).
 */
export function usecaseRunType(inputData: unknown, jobType: unknown): UseCaseNodeType | null {
  const recorded =
    inputData && typeof inputData === "object" && !Array.isArray(inputData) ? (inputData as { type?: unknown }).type : undefined
  const type = typeof recorded === "string" && recorded.length > 0 ? recorded : jobType
  return typeof type === "string" && isUseCaseNodeType(type) ? type : null
}

export type UseCaseFeeCreditId = `use-case-fee:${UseCaseNodeType}`

/** The `model_pricing` id of a use-case node's per-run fee (migration 509). */
export function usecaseFeeCreditId(type: UseCaseNodeType): UseCaseFeeCreditId {
  return `use-case-fee:${type}`
}

/** The static mirror of the fee (STATIC_CREDIT_COSTS / the editor's fallback table). */
export const USE_CASE_FEE_STATIC_CREDITS = 10

export type UseCaseMediaKind = "video" | "audio"
export type PlanTier = EditPlanTier
export interface UseCaseMediaSource {
  readonly url: string
  readonly kind: UseCaseMediaKind
  readonly durationSec?: number
}

export type UseCaseResultKind = "episode" | "clips" | "formats" | "chapters"

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
  /**
   * The wire's mode, only where it is not the default: a step after a
   * per-clip render reads each clip ("each"), as the hand-built clip-pack
   * template's wire does. Absent on every Tighten wire, so P1 hashes hold.
   */
  readonly data?: { readonly outputMode: "each" }
}
export interface UseCaseHandleRef {
  readonly nodeId: string
  readonly handle: string
}
interface UseCaseOutputMapBase {
  readonly json: UseCaseHandleRef
  readonly transcript: UseCaseHandleRef
  readonly planNodeId: string
}
/** One delivered medium (Tighten Episode). `kind` is absent on every P1 snapshot. */
export interface EpisodeOutputMap extends UseCaseOutputMapBase {
  readonly kind?: "episode"
  readonly media: UseCaseHandleRef
  /** The render's own media: what a review-on run delivers (its preview). */
  readonly preview: UseCaseHandleRef
  readonly renderNodeId: string
}
/** A clip per planned clip: `media` is the last per-clip step, whose fan-out rows are the clips. */
export interface ClipsOutputMap extends UseCaseOutputMapBase {
  readonly kind: "clips"
  readonly media: UseCaseHandleRef
  readonly preview: UseCaseHandleRef
  readonly renderNodeId: string
}
/** One delivery per chosen format, in format order. */
export interface FormatsOutputMap extends UseCaseOutputMapBase {
  readonly kind: "formats"
  readonly formats: ReadonlyArray<{ readonly format: string; readonly ref: UseCaseHandleRef }>
  readonly preview: UseCaseHandleRef
  readonly renderNodeId: string
}
/** No render: the plan's chapters (and the text made from them). */
export interface ChaptersOutputMap extends UseCaseOutputMapBase {
  readonly kind: "chapters"
}
/** Which inner node/handle feeds each wrapper output, and the plan/render the review and Render final address. */
export type UseCaseOutputMap = EpisodeOutputMap | ClipsOutputMap | FormatsOutputMap | ChaptersOutputMap

/** What the run delivers. A P1 snapshot names no kind: an episode. */
export function usecaseResultKind(map: UseCaseOutputMap): UseCaseResultKind {
  return map.kind ?? "episode"
}

/** The render a review and a Render final address; null for a graph that renders nothing. */
export function usecaseRenderNodeId(map: UseCaseOutputMap): string | null {
  return map.kind === "chapters" ? null : map.renderNodeId
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
 * preview-stop-rule flag says. Null when the render is final, or the graph
 * renders nothing: the whole graph. In the graph's node order.
 */
export function initialRunNodeIds(graph: UseCaseGraph): string[] | null {
  const renderId = usecaseRenderNodeId(graph.outputMap)
  const render = renderId ? graph.nodes.find((n) => n.id === renderId) : undefined
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
 * know their shape), and the graph's hash. Fresh objects throughout. The
 * snapshot keeps the graph's own output-map kind (a builder that returns an
 * episode map stores one).
 */
export function toStoredInlineGraph<G extends UseCaseGraph>(
  graph: G,
  settings: object,
): StoredInlineGraph & { readonly outputMap: G["outputMap"] } {
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
/** A wire's data: absent, or exactly `{ outputMode: "each" }`. */
const isEdgeData = (v: unknown): boolean => v === undefined || (isRecord(v) && v.outputMode === "each" && Object.keys(v).length === 1)

/** An output map of one of the known result kinds (no kind: a P1 episode). */
function isOutputMap(m: unknown): boolean {
  if (!isRecord(m)) return false
  const base = isHandleRef(m.json) && isHandleRef(m.transcript) && typeof m.planNodeId === "string"
  if (!base) return false
  const rendered = isHandleRef(m.preview) && typeof m.renderNodeId === "string"
  switch (m.kind) {
    case undefined:
    case "episode":
    case "clips":
      return rendered && isHandleRef(m.media)
    case "formats":
      return rendered && Array.isArray(m.formats) && m.formats.length > 0 &&
        m.formats.every((f) => isRecord(f) && typeof f.format === "string" && isHandleRef(f.ref))
    case "chapters":
      return true
    default:
      return false
  }
}

/**
 * Whether a stored value is a use-case snapshot (what `inline_graph` holds for
 * a use-case run). False for anything else, including the `{}` an expunged
 * ordinary execution may hold.
 */
export function isStoredInlineGraph(value: unknown): value is StoredInlineGraph {
  if (!isRecord(value)) return false
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
        typeof e.targetHandle === "string" &&
        isEdgeData(e.data),
    ) &&
    isOutputMap(value.outputMap)
  )
}
