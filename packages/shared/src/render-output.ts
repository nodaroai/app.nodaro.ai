/**
 * A render node's SAVED output — what a render (Apply EDL) hands downstream
 * when the run does not run it: a node outside a Run from here, a Skip-frozen
 * node, or the editor's own read of the canvas. ONE reader, so the two engines
 * cannot pick different takes again (they did: the server took
 * `generatedVideoUrl` first, the editor the selected result).
 *
 *   - A SCALAR edge reads the selected result (`generatedResults[activeResultIndex]`),
 *     as the node's medium (`data.output`). That also repairs a pick saved before
 *     the results gallery wrote the right field: such a node holds the picked
 *     take's index with the newest take still on `generatedVideoUrl`, and the
 *     selected result wins (decided 2026-10-04).
 *   - An EACH edge reads the render's LATEST batch only (`__listResults`, the
 *     rows of its last run once per clip) — never its accumulated history,
 *     which holds earlier runs' clips too (TA6, decided 2026-10-04). A render
 *     that ran once has no batch; the edge then reads the one result.
 *
 * Every item carries what its render stamped on it — `quality` ("proxy" is a
 * Preview) and `clipKey` (the plan clip it was cut from) — copied onto the
 * result by every lane that lands a take.
 */
import { normalizeEdl } from "./edl.js"
import { defaultEdgeOutputMode } from "./producer-types.js"
import { resolveIndex, selectListItems, type SelectorFields } from "./selector.js"

/** The quality an Apply EDL render was made at. "proxy" is a Preview. */
export type RenderQuality = "proxy" | "final"

/** The medium a render hands on. */
export type RenderMedium = "video" | "audio"

/** What a finished render says about itself beside its URL. */
export interface RenderResultStamp {
  readonly quality?: RenderQuality
  /** The plan clip the render was cut from (`edlSpanKey` of that clip). */
  readonly clipKey?: string
}

/** One row of a run's per-item results, row-aligned with them (`{}` = a hole). */
export interface RunResultRowStamp extends RenderResultStamp {
  readonly jobId?: string
  readonly thumbnailUrl?: string
}

/** One saved render result. */
export interface SavedRenderItem extends RenderResultStamp {
  readonly url: string
  readonly medium: RenderMedium
  readonly jobId?: string
  readonly thumbnailUrl?: string
}

type Data = Readonly<Record<string, unknown>>

const MEDIUM_FIELD: Readonly<Record<RenderMedium, string>> = {
  video: "generatedVideoUrl",
  audio: "generatedAudioUrl",
}

const str = (v: unknown): string | undefined => (typeof v === "string" && v.length > 0 ? v : undefined)

/** The stamp a finished render's output carries: a known quality and a
 *  non-empty clip key, nothing else (an unknown value is dropped, not trusted). */
export function renderResultStamp(output: unknown): RenderResultStamp {
  const o = (output && typeof output === "object" ? output : {}) as Record<string, unknown>
  const quality = o.quality === "proxy" || o.quality === "final" ? o.quality : undefined
  const clipKey = str(o.clipKey)
  return { ...(quality ? { quality } : {}), ...(clipKey ? { clipKey } : {}) }
}

/** The medium a render node renders: its `output`, video when absent. */
function mediumOf(data: Data): RenderMedium {
  return data.output === "audio" ? "audio" : "video"
}

interface ResultEntry {
  readonly url?: unknown
  readonly jobId?: unknown
  readonly thumbnailUrl?: unknown
}

function resultsOf(data: Data): readonly ResultEntry[] {
  return Array.isArray(data.generatedResults) ? (data.generatedResults as ResultEntry[]) : []
}

function itemOf(url: string, medium: RenderMedium, entry: ResultEntry | undefined): SavedRenderItem {
  const jobId = str(entry?.jobId)
  const thumbnailUrl = str(entry?.thumbnailUrl)
  return {
    url,
    medium,
    ...(jobId ? { jobId } : {}),
    ...(thumbnailUrl ? { thumbnailUrl } : {}),
    ...(entry ? renderResultStamp(entry) : {}),
  }
}

/** The one result a saved render hands a scalar edge: the selected result (as
 *  the node's medium), else the saved field of its medium, else the other
 *  medium's field (as that medium). */
export function savedRenderOutput(data: Data): SavedRenderItem | undefined {
  const medium = mediumOf(data)
  const results = resultsOf(data)
  const index = typeof data.activeResultIndex === "number" ? data.activeResultIndex : 0
  const selected = results[index] ?? results[0]
  const selectedUrl = str(selected?.url)
  if (selectedUrl) return itemOf(selectedUrl, medium, selected)
  // No results kept (a node saved before results were): the saved field of its
  // medium, else the other medium's — which then names the medium itself.
  const own = str(data[MEDIUM_FIELD[medium]])
  if (own) return { url: own, medium }
  const other: RenderMedium = medium === "video" ? "audio" : "video"
  const otherUrl = str(data[MEDIUM_FIELD[other]])
  return otherUrl ? { url: otherUrl, medium: other } : undefined
}

/** The rows of a saved render's LATEST batch, row-aligned (`null` = a row that
 *  produced nothing), each with what its render stamped. `undefined` when the
 *  render has no batch (it ran once, or never). */
export function savedRenderBatch(data: Data): ReadonlyArray<SavedRenderItem | null> | undefined {
  const batch = data.__listResults
  if (!Array.isArray(batch) || batch.length === 0) return undefined
  const medium = mediumOf(data)
  const byUrl = new Map<string, ResultEntry>()
  for (const entry of resultsOf(data)) {
    const url = str(entry.url)
    if (url && !byUrl.has(url)) byUrl.set(url, entry)
  }
  return batch.map((row) => {
    const url = str(row)
    return url ? itemOf(url, medium, byUrl.get(url)) : null
  })
}

/** The latest batch as the list an each edge iterates (`""` = a hole). */
export function savedRenderBatchUrls(data: Data): string[] | undefined {
  const batch = savedRenderBatch(data)
  return batch ? batch.map((item) => item?.url ?? "") : undefined
}

/**
 * A plan clip's identity: the outer span of its kept segments on the master
 * clock, `${min inMs}-${max outMs}` (integer ms, as `normalizeEdl` rounds them).
 * Taken from the PLAN's clip, never from a rendered EDL — Camera Switch can
 * move a clip's outer edges inward. `undefined` when the value is not an EDL
 * with segments.
 */
export function edlSpanKey(edl: unknown): string | undefined {
  if (!edl || typeof edl !== "object" || Array.isArray(edl)) return undefined
  let segments: ReturnType<typeof normalizeEdl>["segments"]
  try {
    segments = normalizeEdl(edl).segments
  } catch {
    return undefined
  }
  if (segments.length === 0) return undefined
  let min = Infinity
  let max = -Infinity
  for (const s of segments) {
    if (s.inMs < min) min = s.inMs
    if (s.outMs > max) max = s.outMs
  }
  return Number.isFinite(min) && Number.isFinite(max) ? `${min}-${max}` : undefined
}

/** The clip key of row `row` of a clips plan (a list of EDLs, objects or JSON
 *  strings). `undefined` for a plan that is one EDL (Tighten), a missing row,
 *  or a row that is not an EDL. */
export function planClipKeyAt(plan: unknown, row: number): string | undefined {
  if (!Array.isArray(plan)) return undefined
  let clip: unknown = plan[row]
  if (typeof clip === "string") {
    if (!clip.trim()) return undefined
    try {
      clip = JSON.parse(clip)
    } catch {
      return undefined
    }
  }
  return edlSpanKey(clip)
}

/** A node or an edge as the plan walk needs it (either engine's graph). */
export interface RenderGraphNode {
  readonly id: string
  readonly type?: string | null
}
export interface RenderGraphEdge {
  readonly source: string
  readonly target: string
  readonly sourceHandle?: string | null
  readonly targetHandle?: string | null
  /** The wire's settings: its `outputMode` and its range / list selector. */
  readonly data?: unknown
}

/** One wire on the way from the plan to the render that picks clips: the render's
 *  `edl` wire, or a Camera Switch's. */
export interface RenderPlanHop {
  /** The consumer's wire — the one whose selector the input resolvers apply. */
  readonly edge: RenderGraphEdge
  /** Whether the wire hands on one clip per row ("each"), as both resolvers
   *  decide it: its `outputMode`, else the default of the node behind any
   *  teleports, on the handle that node is wired from. */
  readonly each: boolean
  /** The type of the node the wire hands the clips on from, behind any
   *  teleports: what a "Selected" (`last`) wire reads is that node's own output. */
  readonly source?: string
}

/** The Edit Plan behind a render and the wires between them, plan side first. */
export interface RenderPlanPath {
  readonly planId: string
  readonly hops: readonly RenderPlanHop[]
}

const TELEPORT_TYPES: ReadonlySet<string> = new Set(["teleport-send", "teleport-receive"])
/** Nodes that re-cut the EDL they are given (per clip, row for row) and hand
 *  it on: the plan clip behind their output is the clip on their `edl` input. */
const EDL_PASS_THROUGH_TYPES: ReadonlySet<string> = new Set(["camera-switch"])

function outputModeOf(data: unknown): string | undefined {
  const mode = data && typeof data === "object" ? (data as { outputMode?: unknown }).outputMode : undefined
  return typeof mode === "string" ? mode : undefined
}

/**
 * The Edit Plan whose clips a render's `edl` input comes from, and the wires
 * that pick them: up the LAST wire on its `edl` handle (both engines keep the
 * last value), through teleports and Camera Switch. `undefined` when the EDL
 * comes from anything else.
 */
export function renderPlanPath(
  renderId: string,
  nodes: readonly RenderGraphNode[],
  edges: readonly RenderGraphEdge[],
): RenderPlanPath | undefined {
  const byId = new Map(nodes.map((n) => [n.id, n]))
  // The last wire on a node's `edl` handle (the value both engines keep).
  const lastEdlInto = (id: string): RenderGraphEdge | undefined =>
    edges.filter((e) => e.target === id && e.targetHandle === "edl").at(-1)
  // A teleport's one input — the wire both engines' teleport walks follow.
  const teleportInput = (id: string): RenderGraphEdge | undefined => edges.find((e) => e.target === id)
  const visited = new Set<string>()
  const hops: RenderPlanHop[] = []
  let consumer = lastEdlInto(renderId)
  let edge = consumer
  while (edge && consumer) {
    const node = byId.get(edge.source)
    if (!node || visited.has(node.id)) return undefined
    visited.add(node.id)
    if (TELEPORT_TYPES.has(node.type ?? "")) {
      edge = teleportInput(node.id)
      continue
    }
    // The resolvers read the consumer wire's mode and selector, and default the
    // mode from the node behind the teleports on the handle it is wired from.
    const mode = outputModeOf(consumer.data) ?? defaultEdgeOutputMode(node.type, edge.sourceHandle)
    hops.unshift({ edge: consumer, each: mode === "each", ...(node.type ? { source: node.type } : {}) })
    if (node.type === "edit-plan") return { planId: node.id, hops }
    if (!EDL_PASS_THROUGH_TYPES.has(node.type ?? "")) return undefined
    consumer = lastEdlInto(node.id)
    edge = consumer
  }
  return undefined
}

/** The Edit Plan whose clips a render's `edl` input comes from (`renderPlanPath`). */
export function renderPlanNodeId(
  renderId: string,
  nodes: readonly RenderGraphNode[],
  edges: readonly RenderGraphEdge[],
): string | undefined {
  return renderPlanPath(renderId, nodes, edges)?.planId
}

/**
 * The clips a wire that hands on ONE value passes, as both input resolvers pick
 * it (decided 2026-10-05): `item` the clip at its index (its range / list
 * selector does not apply), legacy `item:N` the N-th from 0 (else the first),
 * `all` what its selector leaves (one value only when that is one clip), and
 * "Selected" (`last`) the source's own output — an Edit Plan's is its FIRST
 * clip. A Camera Switch that ran per clip keeps a different clip as its own
 * output in each engine (the server its first, the editor the last to land),
 * so a Selected wire out of it names a clip only when it had one.
 */
function singlePick(clips: readonly unknown[], hop: RenderPlanHop): readonly unknown[] {
  const data = hop.edge.data as (SelectorFields & { itemIndex?: unknown }) | undefined
  const mode = outputModeOf(hop.edge.data)
  if (mode === "item") {
    const expr = typeof data?.itemIndex === "string" ? data.itemIndex : "1"
    return [clips[resolveIndex(expr, clips.length)] ?? clips[0]]
  }
  if (mode?.startsWith("item:")) return [clips[parseInt(mode.slice(5), 10)] ?? clips[0]]
  if (mode === "all") return selectListItems(clips as string[], data)
  if (hop.source === "edit-plan") return clips.slice(0, 1)
  return clips.length === 1 ? clips : []
}

/**
 * The clip a render iteration reads, as a key. `plan` is the plan's clips (a
 * list of EDLs, objects or JSON strings); `hops` the wires from the plan down
 * (`renderPlanPath`). Each "each" wire hands on the clips its selector picks —
 * Camera Switch's row k is row k of ITS selection, the render's row k row k of
 * its own — exactly as both input resolvers select before they index. A wire
 * that hands on one value hands on the clip it picks (`singlePick`), and names
 * one only when exactly one is picked.
 *
 * With a row on an "each" wire, the row's clip; a row past the clips starts
 * over from the first, as the resolvers read it. With no row (a render run
 * once, or Repeat xN with nothing list-driven), the clip only when exactly one
 * is left — any other plan names no single clip.
 */
export function renderClipKey(
  plan: unknown,
  row: number | undefined,
  hops: readonly RenderPlanHop[] = [],
): string | undefined {
  if (!Array.isArray(plan)) return undefined
  let clips: readonly unknown[] = plan
  for (const hop of hops) {
    if (clips.length === 0) return undefined
    if (hop.each) clips = selectListItems(clips as string[], hop.edge.data as SelectorFields | undefined)
    else {
      clips = singlePick(clips, hop)
      if (clips.length !== 1) return undefined
    }
  }
  if (clips.length === 0) return undefined
  const rowed = row !== undefined && (hops.at(-1)?.each ?? true)
  if (rowed) return planClipKeyAt(clips, row % clips.length)
  return clips.length === 1 ? planClipKeyAt(clips, 0) : undefined
}

/**
 * The clip key a render iteration stamps — the ONE rule both engines call: the
 * Edit Plan behind its `edl` wire (`renderPlanPath`), its clips as the engine
 * holds them (`planClips`), picked by every wire on the way and indexed by the
 * iteration's list row (`renderClipKey`). Pass the row only when a list drives
 * it, never an iteration number.
 */
export function renderPlanClipKey(
  renderId: string,
  nodes: readonly RenderGraphNode[],
  edges: readonly RenderGraphEdge[],
  planClips: (planNode: RenderGraphNode) => unknown,
  row: number | undefined,
): string | undefined {
  const path = renderPlanPath(renderId, nodes, edges)
  const planNode = path ? nodes.find((n) => n.id === path.planId) : undefined
  if (!path || !planNode) return undefined
  return renderClipKey(planClips(planNode), row, path.hops)
}
