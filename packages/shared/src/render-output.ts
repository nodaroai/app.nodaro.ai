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
 * Preview), `clipKey` (the plan clip it was cut from), `planBasis` (the plan
 * value it was cut from) and `renderBasis` (the render's own settings) —
 * copied onto the result by every lane that lands a take.
 */
import { normalizeEdl } from "./edl.js"
import { editPlanBasis } from "./edit-plan-review.js"
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
  /** The plan value the render was cut from (`renderReadBasis`): stamped only
   *  when that value is the plan's own (`renderPlanBasis`). Absent = unknown. */
  readonly planBasis?: string
  /** The render's own settings (`renderSettingsBasis`): its output, its
   *  crossfade and the media it read. */
  readonly renderBasis?: string
}

/** One row of a run's per-item results, row-aligned with them. A row that
 *  produced nothing (a hole) carries no take's fields; a render's hole still
 *  says what it was sent for (`renderSentRowStamps`): the quality its run
 *  renders at and, when the run can name it, its clip (`clipKey`,
 *  `renderPlanRowClipKeys`), so a failed row is matched to its clip by key.
 *  `{}` is a hole that names none (a run made before every row was stamped, or
 *  a node that is not a render). */
export interface RunResultRowStamp extends RenderResultStamp {
  readonly jobId?: string
  readonly thumbnailUrl?: string
  /** The row never ran: a Stop, or the fail-fast after another row failed,
   *  skipped it. It is a hole, never a failure. */
  readonly cancelled?: true
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

const BASIS = /^[0-9a-f]{16}$/
/** A basis as `editPlanBasis` writes it — 16 lowercase hex digits — or nothing. */
const basisOf = (v: unknown): string | undefined => (typeof v === "string" && BASIS.test(v) ? v : undefined)

/** The stamp a finished render's output carries: a known quality, a non-empty
 *  clip key and the two bases as 16 hex digits, nothing else (an unknown value
 *  is dropped, not trusted). */
export function renderResultStamp(output: unknown): RenderResultStamp {
  const o = (output && typeof output === "object" ? output : {}) as Record<string, unknown>
  const quality = o.quality === "proxy" || o.quality === "final" ? o.quality : undefined
  const clipKey = str(o.clipKey)
  const planBasis = basisOf(o.planBasis)
  const renderBasis = basisOf(o.renderBasis)
  return {
    ...(quality ? { quality } : {}),
    ...(clipKey ? { clipKey } : {}),
    ...(planBasis ? { planBasis } : {}),
    ...(renderBasis ? { renderBasis } : {}),
  }
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

/** Whether every pass-through node on the path (Camera Switch: the target of
 *  every hop but the last) ran in this run (`ranIds`) — the same-run rule. */
function passThroughRan(path: RenderPlanPath, ranIds: ReadonlySet<string>): boolean {
  return path.hops.slice(0, -1).every((hop) => ranIds.has(hop.edge.target))
}

/** The Edit Plan whose clips a render's `edl` input comes from (`renderPlanPath`). */
export function renderPlanNodeId(
  renderId: string,
  nodes: readonly RenderGraphNode[],
  edges: readonly RenderGraphEdge[],
): string | undefined {
  return renderPlanPath(renderId, nodes, edges)?.planId
}

/** A dropped clip's place in a plan list (TA16): `""` or `null`. Clips are
 *  objects as well as JSON text, so this is never "not a string". */
const isHole = (clip: unknown): boolean => clip == null || (typeof clip === "string" && !clip.trim())

/** The clips left once the holes are dropped, in order. */
const keptClips = (clips: readonly unknown[]): readonly unknown[] => clips.filter((clip) => !isHole(clip))

/**
 * The clips a wire that hands on ONE value passes, as both input resolvers pick
 * it (decided 2026-10-05): `item` the clip at its index (its range / list
 * selector does not apply), legacy `item:N` the N-th from 0 (else the first),
 * `all` what its selector leaves (one value only when that is one clip), and
 * "Selected" (`last`) the source's own output — an Edit Plan's is its first
 * KEPT clip, the scalar both engines read off a list with holes. A Camera Switch that ran per clip keeps a different clip as its own
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
  if (hop.source === "edit-plan") return keptClips(clips).slice(0, 1)
  return clips.length === 1 ? clips : []
}

/**
 * The plan value a render iteration reads. `plan` is the plan's output as the
 * engine holds it: a clip set's clips (a list of EDLs, objects or JSON strings,
 * `""` at a dropped clip), or a Tighten plan's one EDL — which every wire hands
 * on as it is. `hops` are the wires from the plan down (`renderPlanPath`). Each
 * "each" wire hands on the clips its selector picks — Camera Switch's row k is
 * row k of ITS selection, the render's row k row k of its own — exactly as both
 * input resolvers select before they index. A wire that hands on one value
 * hands on the clip it picks (`singlePick`), and names one only when exactly
 * one is picked.
 *
 * Holes (a dropped clip, TA16) follow the row space each wire really hands on.
 * A pass-through node (Camera Switch: every hop but the last) runs once per
 * KEPT clip of its selection and both engines store its batch by iteration, so
 * the next wire reads a list without the holes. The last wire, into the
 * render, is not compacted: a render wired straight to the plan is rowed in
 * the plan's own rows, holes included.
 *
 * With a row on an "each" wire, the row's clip; a row past the clips starts
 * over from the first, as the resolvers read it. With no row (a render run
 * once, or Repeat xN with nothing list-driven), the clip only when exactly one
 * KEPT clip is left — the scalar both engines read — and any other plan names
 * no single clip. An empty row names nothing.
 */
export function renderPlanValue(
  plan: unknown,
  row: number | undefined,
  hops: readonly RenderPlanHop[] = [],
): unknown {
  if (!Array.isArray(plan)) return plan === null || typeof plan !== "object" ? undefined : plan
  let clips: readonly unknown[] = plan
  for (const [i, hop] of hops.entries()) {
    if (clips.length === 0) return undefined
    if (hop.each) {
      clips = selectListItems(clips as string[], hop.edge.data as SelectorFields | undefined)
      // Into a pass-through node: it hands on its batch by iteration, one per kept clip.
      if (i < hops.length - 1) clips = keptClips(clips)
    } else {
      clips = singlePick(clips, hop)
      if (clips.length !== 1) return undefined
    }
  }
  if (clips.length === 0) return undefined
  const rowed = row !== undefined && (hops.at(-1)?.each ?? true)
  if (rowed) {
    const clip = clips[row % clips.length]
    return isHole(clip) ? undefined : clip
  }
  const kept = keptClips(clips)
  return kept.length === 1 ? kept[0] : undefined
}

/** The clip a render iteration reads, as a key (`edlSpanKey` of the clip
 *  `renderPlanValue` picks). A Tighten plan names no clip. */
export function renderClipKey(
  plan: unknown,
  row: number | undefined,
  hops: readonly RenderPlanHop[] = [],
): string | undefined {
  if (!Array.isArray(plan)) return undefined
  const clip = renderPlanValue(plan, row, hops)
  return clip === undefined ? undefined : planClipKeyAt([clip], 0)
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

/**
 * The clip key of EVERY iteration of a render's fan-out, row-aligned with its
 * batch: `rows[k]` is iteration k's list row (`FanOutPlan.rows`), as both
 * engines hand it to `renderPlanClipKey` (never the iteration number). Both
 * engines stamp it on each batch row up front, so a row that FAILED still
 * names its clip (decided 2026-10-06): the batch has one row per run, not one
 * per plan clip, and a reader matches rows to clips by this key, never by
 * position. The plan is read once, as the run held it when the fan-out began.
 */
export function renderPlanRowClipKeys(
  renderId: string,
  nodes: readonly RenderGraphNode[],
  edges: readonly RenderGraphEdge[],
  planClips: (planNode: RenderGraphNode) => unknown,
  rows: ReadonlyArray<number | undefined>,
  ranIds: ReadonlySet<string>,
): Array<string | undefined> {
  const path = renderPlanPath(renderId, nodes, edges)
  const planNode = path ? nodes.find((n) => n.id === path.planId) : undefined
  // The same-run rule (`renderPlanBasis`): behind a pass-through node that did
  // not run in this run the render iterates that node's SAVED batch, which can
  // come from an older review, so the plan as it is now cannot name its rows.
  if (!path || !planNode || !passThroughRan(path, ranIds)) return rows.map(() => undefined)
  const plan = planClips(planNode)
  return rows.map((row) => renderClipKey(plan, row, path.hops))
}

/** The quality a render runs at: its `quality` setting as the run holds it
 *  ("proxy" is a Preview; anything else renders a final). */
export function renderRunQuality(data: Readonly<Record<string, unknown>> | undefined): RenderQuality {
  return data?.quality === "proxy" ? "proxy" : "final"
}

/**
 * What every row of a render's fan-out batch is stamped with before it runs
 * (decided 2026-10-06): the quality the run renders at and the clip the row is
 * sent for (`renderPlanRowClipKeys`, absent when the run cannot name it). Both
 * engines write it on every row; a landed take's own stamp wins over it, so a
 * row that FAILED still says which clip, and at which quality, it was sent for.
 */
export function renderSentRowStamps(
  quality: RenderQuality,
  clipKeys: ReadonlyArray<string | undefined>,
): RunResultRowStamp[] {
  return clipKeys.map((clipKey) => ({ quality, ...(clipKey ? { clipKey } : {}) }))
}

// ─────────────────────────────────────────────────────────────────────────
//  The bases a render is stamped with (A3-1)
// ─────────────────────────────────────────────────────────────────────────

/** `renderReadBasis` of every plan object already hashed (see `editPlanBasis`:
 *  plan objects are never mutated in place). Keyed by the object the caller
 *  holds, since stripping `meta` makes a new one every time. */
const readBasisByValue = new WeakMap<object, string>()

const isPlainObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v)

/**
 * The fingerprint of the plan value a render read (R2 a, decided 2026-10-06):
 * `editPlanBasis` of the value with its top-level `meta` removed. No renderer
 * reads `meta`, so an edited hook (a clip's `meta.hook`, text only) leaves it
 * unchanged. A clip given as JSON text reads as its object. `undefined` for
 * anything that is not one plan object (a list, a scalar, unparsable text).
 */
export function renderReadBasis(value: unknown): string | undefined {
  let v = value
  if (typeof v === "string") {
    if (!v.trim()) return undefined
    try {
      v = JSON.parse(v)
    } catch {
      return undefined
    }
  }
  if (!isPlainObject(v)) return undefined
  const cached = readBasisByValue.get(v)
  if (cached !== undefined) return cached
  const { meta: _meta, ...rest } = v
  const basis = editPlanBasis(rest)
  readBasisByValue.set(v, basis)
  return basis
}

/** A render's own settings, as it reads them. */
export interface RenderSettingsInput {
  /** Any value other than "audio" is a video render. */
  readonly output?: unknown
  /** The default crossfade in ms; missing, negative or non-finite is a hard cut. */
  readonly crossfadeMs?: unknown
}

/**
 * The fingerprint of a render's own settings (R19 a, decided 2026-10-06):
 * `editPlanBasis({crossfadeMs, output, sources})`. `sources` is the EFFECTIVE
 * source list — the URL of each source of the effective EDL the render cuts,
 * in order, with the `sources` wires' overrides applied (`""` for a source with
 * no URL). A change to any of the three changes the cut while the plan value
 * stays equal. The settings are read as the render reads them: whole ms, a
 * hard cut when the crossfade is missing.
 */
export function renderSettingsBasis(settings: RenderSettingsInput, sources: ReadonlyArray<string | undefined> = []): string {
  const raw = settings.crossfadeMs
  const crossfadeMs = typeof raw === "number" && Number.isFinite(raw) ? Math.max(0, Math.round(raw)) : 0
  return editPlanBasis({
    crossfadeMs,
    output: settings.output === "audio" ? "audio" : "video",
    sources: sources.map((url) => (typeof url === "string" ? url : "")),
  })
}

/**
 * The plan basis a render iteration stamps — the ONE rule both engines call
 * (R1 a, decided 2026-10-06). The plan value the iteration read
 * (`renderPlanValue` of `planOutput` — the plan's output as the run holds it —
 * along `renderPlanPath`), as `renderReadBasis`.
 *
 * THE SAME-RUN RULE. Behind a pass-through node (Camera Switch) the render reads
 * that node's output, which is the plan's current value only when the node ran
 * in the same run as the render; a SAVED output can come from an older plan.
 * So the basis is stamped only when every pass-through node on the path is in
 * `ranIds`, the nodes executed in the render's run, and is `undefined`
 * otherwise — the take then reads as unknown (stale), never as current. A
 * render wired straight to the plan (through teleports at most) reads the
 * plan's output itself and is always stamped.
 */
export function renderPlanBasis(
  renderId: string,
  nodes: readonly RenderGraphNode[],
  edges: readonly RenderGraphEdge[],
  planOutput: (planNode: RenderGraphNode) => unknown,
  row: number | undefined,
  ranIds: ReadonlySet<string>,
): string | undefined {
  const path = renderPlanPath(renderId, nodes, edges)
  const planNode = path ? nodes.find((n) => n.id === path.planId) : undefined
  if (!path || !planNode) return undefined
  if (!passThroughRan(path, ranIds)) return undefined
  return renderReadBasis(renderPlanValue(planOutput(planNode), row, path.hops))
}
