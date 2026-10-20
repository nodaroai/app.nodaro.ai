/**
 * A use-case node, for an ESTIMATE, is the chain it builds wired to its real
 * upstream source (decided 2026-10-13): every estimator — the backend run
 * estimate, the app listing, the editor — expands it with this one function
 * and prices the result with its ordinary rules, plus the node's fee. So the
 * one-node estimate is the hand-built chain's estimate by construction. Pure:
 * fresh objects, the inputs are never touched.
 *
 * Every type is built through its registry descriptor (`use-case-registry.ts`).
 * Inner ids are `<nodeId>::<inner id>`. The built node each wired input stands
 * for (`inputNodeIds`: the source for `media`, the bed for `music`, …) is
 * REPLACED by the node wired into it, on that wire's handle — recording i of
 * `media`, in the node's `mediaOrder`, replaces `usecaseRecordingNodeId(i)`,
 * the first of them the source — so the plan's
 * and the render's length read the real recording. An unwired node keeps its
 * placeholder source (unknown length: the ceiling). Wires out of the node
 * leave from the mapped output (`json` → the plan's edit, `transcript` → the
 * transcript, anything else → the delivered media, or a stand-in List of the
 * deliveries when there are several), keeping the mode they had leaving the
 * node.
 *
 * A node that runs its Render final (`useCaseContinue: { mode: "render-final" }`,
 * an override of that run only) continues a run that paid its fee: it is
 * built — from the settings of that run when the continuation carries them
 * (`settings`, the preview's) — as the FINAL chain (review off, its render at final, its consumers
 * reading the episode), its members are what the server's continuation runs
 * (`renderFinalRunSet`: its render, what follows it, and what sits between its
 * plan and its render — a multicam run's Camera Switch), and it has no fee. Its earlier steps stay on the graph, unrun, for the render to
 * read — its plan holding the run's plan and the reviewer's edit, kept on the
 * node — so price it as a run subset.
 */
import { AUDIO_PRODUCER_TYPES, DYNAMIC_PRODUCER_TYPES, defaultEdgeOutputMode } from "@nodaro/shared/nodes"
import {
  initialRunNodeIds,
  isUseCaseNodeType,
  usecaseFeeCreditId,
  usecaseRenderNodeId,
  type UseCaseFeeCreditId,
  type UseCaseGraph,
  type UseCaseHandleRef,
  type UseCaseMediaKind,
  type UseCaseNodeType,
} from "./use-case-graph"
import { mediaLengthSecOf } from "./apply-edl-estimate"
import { renderFinalRunSet } from "./render-final-set"
import { USE_CASE_MASTER_NODE_ID, usecaseRecordingNodeId, usecaseRecordingsOf, type UseCaseSourcesShape } from "./use-case-cameras"
import { usecaseDistinctMaster, usecaseRecordingsKind, usecaseRunMaxRecordings, usecaseSoundRecordingIndex } from "./use-case-multicam"
import { usecaseFramesAvailableFor, usecaseFramingForViewer } from "./use-case-framing-viewer"
import { usecaseDescriptor, type UseCaseInputHandle, type UseCaseSources } from "./use-case-registry"

type AnyNode = { readonly id?: string; readonly type?: string | null; readonly data?: unknown }
type AnyEdge = { readonly source?: string; readonly target: string; readonly sourceHandle?: string | null; readonly targetHandle?: string | null; readonly data?: unknown }

export interface UseCaseExpandedNode { readonly id: string; readonly type: string; readonly data: Record<string, unknown> }
export interface UseCaseExpandedEdge {
  readonly source: string
  readonly target: string
  readonly sourceHandle: string | null
  readonly targetHandle: string | null
  /** The outer wire's own data (its output mode), on an inner wire that starts from the node's real source. */
  readonly data?: unknown
}
export interface UseCaseExpansion<N, E> {
  readonly nodes: ReadonlyArray<N | UseCaseExpandedNode>
  readonly edges: ReadonlyArray<E | UseCaseExpandedEdge>
  /** One fee per use-case node, by its pricing id — none for a node running its Render final. */
  readonly fees: ReadonlyArray<{ readonly nodeId: string; readonly creditId: UseCaseFeeCreditId }>
  /** Each use-case node's inner node ids that run (its replaced inputs excluded; a Render final: its render and what follows; a deliveries stand-in included). */
  readonly members: ReadonlyMap<string, readonly string[]>
  /** False when the graph holds no use-case node: `nodes`/`edges` are copies of the input. */
  readonly expanded: boolean
}

export interface UseCaseExpandOptions {
  /**
   * `first-run` (the default): a review-on node is the chain its run executes,
   * up to and including its proxy render; what follows the render runs once,
   * in its Render final, and is left out — a run estimate. `whole`: every
   * built node, the render still at proxy — a listing, whose final part prices
   * each Render final (the render at final and everything after it). The two
   * differ only for a review-on node.
   */
  readonly chain?: "first-run" | "whole"
  /**
   * Whether the viewer the estimate is for may run several cameras (Speaker
   * Map is available to them, decided 2026-10-19): then a node reads every
   * recording its type takes and its Master audio; otherwise (the default)
   * the first recording only, as before multicam (`usecaseRunMaxRecordings`).
   */
  readonly multicam?: boolean
  /**
   * Speaker Frames is withheld from the viewer (decided 2026-10-20): an `auto`
   * framing source is priced as the run reads it, the even split
   * (`usecaseFramingForViewer`). Absent: available — `auto` is priced
   * following faces, never under the run's hold.
   */
  readonly framesWithheld?: boolean
}

const PLACEHOLDER_URL = "estimate://use-case-source"

/**
 * The stand-in source a wired optional input is built on (its real source
 * replaces it after the build): one per input, typed as the builder reads it,
 * so a new input cannot be built on an untyped stand-in — Master audio is
 * audio.
 */
const OPTIONAL_INPUT_PLACEHOLDERS: { readonly [H in Exclude<UseCaseInputHandle, "media">]: NonNullable<UseCaseSources[H]> } = {
  music: { url: PLACEHOLDER_URL },
  introCard: { url: PLACEHOLDER_URL },
  masterAudio: { url: PLACEHOLDER_URL, kind: "audio" },
}

/**
 * What the recording wired into `media` is. Video unless it is certainly
 * audio: the video chain (captions included) is the pricier one, so an
 * uncertain source never under-quotes. A node that hands on either kind is
 * read by the wire's handle. The editor's panel reads it too, so the episode
 * it shows forced to audio is the one the estimate builds.
 */
export function usecaseMediaKindOf(node: AnyNode | undefined, handle: string | null | undefined): UseCaseMediaKind {
  if (!node) return "video"
  const h = handle ?? ""
  if (h.includes("video")) return "video"
  if ((node.data as { output?: unknown } | undefined)?.output === "audio") return "audio"
  const type = node.type ?? ""
  if (!AUDIO_PRODUCER_TYPES.has(type)) return "video"
  return !DYNAMIC_PRODUCER_TYPES.has(type) || h.includes("audio") ? "audio" : "video"
}

const inner = (useCaseId: string, id: string): string => `${useCaseId}::${id}`

/** The inner refs a wire leaving a use-case node on `handle` starts from (one per delivery for a format list). */
function outputRefs(g: UseCaseGraph, handle: string | null, whole: boolean): UseCaseHandleRef[] {
  const m = g.outputMap
  if (handle === "json") return [m.json]
  if (handle === "transcript") return [m.transcript]
  // Chapters renders nothing: its text is made from the plan's chapters.
  if (m.kind === "chapters") return [m.json]
  // A review-on node delivers its preview until its Render final; a whole
  // chain keeps what follows the render, so its consumers read the deliveries.
  if (!whole && initialRunNodeIds(g)) return [m.preview]
  return m.kind === "formats" ? m.formats.map((f) => f.ref) : [m.media]
}

/**
 * The node runs its Render final: a continuation of its run, set for that run
 * only. It names that run (`jobId`) — the same test as `rendersAsPreview`
 * (@nodaro/shared) and the server engine's: without one the node runs fresh,
 * and is priced as a fresh run (fee and whole first run), never as a final.
 */
export function runsUseCaseRenderFinal(data: unknown): boolean {
  const pending = (data as { useCaseContinue?: { mode?: unknown; jobId?: unknown } | null } | null | undefined)?.useCaseContinue
  return pending?.mode === "render-final" && typeof pending.jobId === "string"
}

/** The settings the run a Render final finishes was built from, when its continuation carries them. */
function renderFinalSettingsOf(data: Readonly<Record<string, unknown>>): Readonly<Record<string, unknown>> | undefined {
  const s = (data.useCaseContinue as { settings?: unknown } | null | undefined)?.settings
  return s && typeof s === "object" && !Array.isArray(s) ? (s as Readonly<Record<string, unknown>>) : undefined
}

/**
 * Node ids named INSIDE built node data follow the renaming of the nodes they
 * name, or the plan would look for a source that is not on the graph and price
 * at the ceiling: the plan's `sourceOrder`, `sourceConfig` keys and
 * `reference`; the mix's `trackOrder` and `duckUnder`; Combine Videos'
 * `clipOrder`; a camera switch's `speakerMapByOrder` values; a Speaker Map's
 * `masterSourceId` and `wideSourceId`. A key the data does not carry stays
 * absent, and the keys P1 and P2 data carry are renamed as they always were
 * (a list whenever it is a list, `duckUnder` whenever it is a string). An id
 * among the newer single ids is renamed only when it names a node (an empty
 * one is "none"). `reference` is a common word (Audio Sync's reference
 * recording is a node id; another node's could be a URL or a mode): given the
 * built graph's node ids (`nodeIds`), it is renamed only when it is one of
 * them. Exported for tests.
 */
export function usecaseRenameInnerIds(
  data: Readonly<Record<string, unknown>>,
  rename: (id: string) => string,
  nodeIds?: ReadonlySet<string>,
): Record<string, unknown> {
  const list = (v: unknown) => (v as string[]).map(rename)
  const one = (v: unknown) => (typeof v === "string" && v !== "" ? rename(v) : v)
  const nodeRef = (v: unknown) => (typeof v === "string" && nodeIds && !nodeIds.has(v) ? v : one(v))
  const isMap = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v)
  return {
    ...data,
    ...(Array.isArray(data.sourceOrder) ? { sourceOrder: list(data.sourceOrder) } : {}),
    ...(Array.isArray(data.trackOrder) ? { trackOrder: list(data.trackOrder) } : {}),
    ...(typeof data.duckUnder === "string" ? { duckUnder: rename(data.duckUnder) } : {}),
    ...(Array.isArray(data.clipOrder) ? { clipOrder: list(data.clipOrder) } : {}),
    ...("reference" in data ? { reference: nodeRef(data.reference) } : {}),
    ...("masterSourceId" in data ? { masterSourceId: one(data.masterSourceId) } : {}),
    ...("wideSourceId" in data ? { wideSourceId: one(data.wideSourceId) } : {}),
    ...(isMap(data.sourceConfig) ? { sourceConfig: Object.fromEntries(Object.entries(data.sourceConfig).map(([k, x]) => [rename(k), x])) } : {}),
    ...(isMap(data.speakerMapByOrder) ? { speakerMapByOrder: Object.fromEntries(Object.entries(data.speakerMapByOrder).map(([k, x]) => [k, one(x)])) } : {}),
  }
}

/** The expansion of every use-case node on the graph (see the module note). */
export function expandUseCaseNodes<N extends AnyNode, E extends AnyEdge>(
  nodes: readonly N[],
  edges: readonly E[],
  options?: UseCaseExpandOptions,
): UseCaseExpansion<N, E> {
  const useCases = nodes.filter((n): n is N & { readonly id: string; readonly type: UseCaseNodeType } => typeof n.id === "string" && isUseCaseNodeType(n.type))
  if (useCases.length === 0) return { nodes: [...nodes], edges: [...edges], fees: [], members: new Map(), expanded: false }

  const whole = options?.chain === "whole"
  const multicam = options?.multicam === true
  const framesAvailable = usecaseFramesAvailableFor(options)
  const byId = new Map(nodes.flatMap((n) => (typeof n.id === "string" ? [[n.id, n] as const] : [])))
  const ucIds = new Set(useCases.map((u) => u.id))
  const wireInto = (id: string, handle: string) => edges.find((e) => e.target === id && e.targetHandle === handle && !!e.source)
  /**
   * The recordings a node reads: its `media` wires in the node's `mediaOrder`
   * (both engines' order), one per upstream node, up to as many as its type
   * takes for this viewer (`usecaseRunMaxRecordings`). Wire i is recording
   * i. With no `mediaOrder` the first is the first wire, as it always was.
   */
  const mediaWires = (u: N & { readonly id: string; readonly type: UseCaseNodeType }): E[] =>
    usecaseRecordingsOf(
      edges.filter((e) => e.target === u.id && e.targetHandle === "media" && !!e.source).map((edge) => ({ nodeId: edge.source!, edge })),
      u.data,
      usecaseRunMaxRecordings(usecaseDescriptor(u.type).maxRecordings, multicam),
    ).map((w) => w.edge)
  const kindOf = (w: E | undefined): UseCaseMediaKind => usecaseMediaKindOf(byId.get(w?.source ?? ""), w?.sourceHandle)

  /** Each node's recordings, read once: the build and the replacement below use the same wires. */
  const recordingWires = new Map(useCases.map((u) => [u.id, mediaWires(u)] as const))
  /**
   * The wire into a node's optional input `h`, as the run reads it: a Master
   * audio wired from one of its recordings' nodes is no Master audio
   * (`usecaseDistinctMaster`) — neither built nor replaced, as the route builds it.
   */
  const inputWire = (id: string, h: Exclude<UseCaseInputHandle, "media">): E | undefined => {
    const w = wireInto(id, h)
    if (h !== "masterAudio" || !w) return w
    // A viewer who may not run several cameras reads no Master audio either.
    if (!multicam) return undefined
    return usecaseDistinctMaster(w.source!, (recordingWires.get(id) ?? []).map((r) => r.source!)) ? w : undefined
  }

  const built = new Map<string, UseCaseGraph>()
  /**
   * A built `uc-master` no Master audio wire replaces (the sound a multicam
   * run repeats from a camera, decided 2026-10-17) stays an inner node, and
   * takes the recorded length of the recording it repeats — else the plan's
   * clock is a placeholder of unknown length and the run is quoted at the
   * ceiling. It is not replaced by that recording's wire: Audio Sync is priced
   * per source, and the run aligns the second source too.
   */
  const soundLengthSec = new Map<string, number>()
  const finals = new Set(useCases.filter((u) => runsUseCaseRenderFinal(u.data)).map((u) => u.id))
  for (const u of useCases) {
    const d = usecaseDescriptor(u.type)
    const wires = recordingWires.get(u.id)!
    const kinds = wires.map(kindOf)
    // The run's kind from every recording's (one rule with the route and the
    // audio lock); none wired is read as an unknown one is: video.
    const kind = usecaseRecordingsKind(kinds) ?? kindOf(undefined)
    // A wired optional input is a placeholder of its own (its real source replaces it below).
    const optional: Partial<Pick<UseCaseSources, Exclude<UseCaseInputHandle, "media">>> = Object.fromEntries(
      d.inputs.flatMap((h) => (h !== "media" && inputWire(u.id, h) ? [[h, { ...OPTIONAL_INPUT_PLACEHOLDERS[h] }] as const] : [])),
    )
    const shape: UseCaseSourcesShape = { recordings: Math.max(1, wires.length), masterAudio: optional.masterAudio !== undefined }
    const raw = (u.data ?? {}) as Readonly<Record<string, unknown>>
    // A Render final renders with the settings of the run it finishes (the
    // preview's, carried on the continuation), never the node's later ones.
    // The framing source as the viewer's run reads it (`usecaseFramingForViewer`); a Render final's
    // stored settings are already resolved (never `auto`).
    const own = usecaseFramingForViewer(raw, framesAvailable)
    const settings = d.resolveSettings(finals.has(u.id) ? { ...(renderFinalSettingsOf(raw) ?? own), reviewBeforeRender: false } : own, kind, shape)
    // Recordings 2..n are placeholders too, each of its own kind (absent for one recording).
    const moreMedia: UseCaseSources["moreMedia"] = wires.length > 1 ? wires.slice(1).map((w) => ({ url: PLACEHOLDER_URL, kind: kindOf(w) })) : undefined
    const g = d.build(settings, { media: { url: PLACEHOLDER_URL, kind: kinds[0] ?? kind }, ...(moreMedia ? { moreMedia } : {}), ...optional })
    built.set(u.id, g)
    if (!optional.masterAudio && g.nodes.some((n) => n.id === USE_CASE_MASTER_NODE_ID)) {
      const wide = (settings as { readonly cameras?: { readonly wide?: unknown } }).cameras?.wide
      const i = usecaseSoundRecordingIndex(kinds, typeof wide === "number" ? wide : null, false)
      const sec = i === null ? undefined : mediaLengthSecOf(byId.get(wires[i]?.source ?? "")?.data as Record<string, unknown> | undefined)
      if (sec !== undefined) soundLengthSec.set(u.id, sec)
    }
  }

  /**
   * Where a wire leaving use-case node `nodeId` on `handle` starts. One inner
   * ref: that ref. Several (a Trailer's formats, each its own node): a
   * stand-in List of one item per delivery, so the node after it runs once per
   * delivery on an Each wire and receives them all on a Bundle wire — what the
   * run does with the node's own list. The stand-in is free (a List).
   */
  const deliveries = new Map<string, { readonly owner: string; readonly node: UseCaseExpandedNode }>()
  const fromOne = (nodeId: string, handle: string | null): { source: string; sourceHandle: string | null } => {
    const g = built.get(nodeId)
    if (!g) return { source: nodeId, sourceHandle: handle }
    const refs = outputRefs(g, handle, whole)
    if (refs.length === 1) return { source: inner(nodeId, refs[0]!.nodeId), sourceHandle: refs[0]!.handle }
    const id = inner(nodeId, "uc-deliveries")
    if (!deliveries.has(id)) {
      deliveries.set(id, { owner: nodeId, node: { id, type: "list", data: { items: refs.map((r) => inner(nodeId, r.nodeId)).join("\n") } } })
    }
    return { source: id, sourceHandle: "text" }
  }

  /**
   * The data a wire leaving use-case node `e.source` keeps: its own, with the
   * mode it had leaving the node — set on it, else the NODE's default (a list
   * result's "each", FAN_OUT_EACH_HANDLES), never the inner source's, or a node
   * after a Clip Pack would be priced once, not per clip. Every wire that
   * leaves a use-case node reads it: to a plain node, or into another
   * use-case node's input.
   */
  const leavingData = (e: E): Record<string, unknown> => {
    const own = (e.data as Record<string, unknown> | undefined) ?? {}
    const mode = own.outputMode ?? defaultEdgeOutputMode(byId.get(e.source ?? "")?.type, e.sourceHandle ?? null)
    return { ...own, outputMode: mode }
  }

  const outNodes: Array<N | UseCaseExpandedNode> = nodes.filter((n) => !(typeof n.id === "string" && ucIds.has(n.id)))
  const outEdges: Array<E | UseCaseExpandedEdge> = []
  for (const e of edges) {
    if (ucIds.has(e.target)) continue // replaced by the inner wires below
    if (!e.source || !ucIds.has(e.source)) {
      outEdges.push(e)
      continue
    }
    outEdges.push({ ...e, ...fromOne(e.source, e.sourceHandle ?? null), data: leavingData(e) })
  }

  const fees: Array<{ nodeId: string; creditId: UseCaseFeeCreditId }> = []
  const members = new Map<string, readonly string[]>()
  for (const u of useCases) {
    const g = built.get(u.id)!
    // A replaced input keeps the outer wire's data (its output mode, Each or
    // All): every inner step reads the source the way the node would have. A
    // wire from another use-case node keeps the mode it had leaving that node.
    const replaced = new Map<string, { source: string; sourceHandle: string | null; data?: unknown }>()
    const d = usecaseDescriptor(u.type)
    const fromWire = (w: E) => ({
      ...fromOne(w.source!, w.sourceHandle ?? null),
      ...(ucIds.has(w.source!) ? { data: leavingData(w) } : w.data !== undefined ? { data: w.data } : {}),
    })
    // Recording i replaces the built node it stands for (the first: the
    // source, `inputNodeIds.media`); each other wired input replaces its own.
    recordingWires.get(u.id)!.forEach((w, i) => replaced.set(usecaseRecordingNodeId(i), fromWire(w)))
    for (const h of d.inputs) {
      if (h === "media") continue
      const w = inputWire(u.id, h)
      const builtId = d.inputNodeIds[h]
      if (w && builtId) replaced.set(builtId, fromWire(w))
    }
    const rename = (id: string) => replaced.get(id)?.source ?? inner(u.id, id)
    const builtIds = new Set(g.nodes.map((n) => n.id))
    const firstRun = whole ? null : initialRunNodeIds(g)
    const runs = (id: string) => !firstRun || firstRun.includes(id)
    // A Render final runs its render and what follows it; the rest is read, not
    // run. A graph that renders nothing has no Render final (it is not reviewable).
    const renderId = usecaseRenderNodeId(g.outputMap)
    // What the server's continuation runs (renderFinalRunSet): the render and
    // what follows, and whatever sits between the plan and the render (a
    // multicam run's Camera Switch, re-run on the reviewed cut).
    const finalPart = renderId !== null && finals.has(u.id) ? renderFinalRunSet(renderId, g.nodes, g.edges) : null
    const final = finalPart !== null
    const ids: string[] = []
    // Its plan is the run's, kept on the node (and the reviewer's edit of it):
    // the render it finishes is priced on that cut, as the run renders it.
    const ran = (u.data ?? {}) as Readonly<Record<string, unknown>>
    const planResult = final
      ? { ...(ran.generatedJson !== undefined ? { generatedJson: ran.generatedJson } : {}), ...(ran.editedEdl !== undefined ? { editedEdl: ran.editedEdl } : {}) }
      : {}
    for (const n of g.nodes) {
      if (replaced.has(n.id) || !runs(n.id)) continue
      if (!finalPart || finalPart.has(n.id)) ids.push(inner(u.id, n.id))
      const renamed = usecaseRenameInnerIds(n.data, rename, builtIds)
      const soundSec = n.id === USE_CASE_MASTER_NODE_ID ? soundLengthSec.get(u.id) : undefined
      const data = soundSec === undefined ? renamed : { ...renamed, metadata: { ...(renamed.metadata as Record<string, unknown> | undefined), durationSeconds: soundSec } }
      outNodes.push({ id: inner(u.id, n.id), type: n.type, data: n.id === g.outputMap.planNodeId ? { ...data, ...planResult } : data })
    }
    for (const e of g.edges) {
      if (!runs(e.target) || (!replaced.has(e.source) && !runs(e.source))) continue
      const start = replaced.get(e.source) ?? { source: inner(u.id, e.source), sourceHandle: e.sourceHandle }
      // A built wire's own mode (an Each wire inside the chain) is priced as one.
      outEdges.push({ ...start, target: inner(u.id, e.target), targetHandle: e.targetHandle, ...(e.data ? { data: e.data } : {}) })
    }
    if (!final) fees.push({ nodeId: u.id, creditId: usecaseFeeCreditId(g.nodeType) })
    members.set(u.id, ids)
  }
  // A deliveries stand-in "runs" whenever its node does: a run subset that names the node names it too.
  for (const [id, { owner, node }] of deliveries) {
    outNodes.push(node)
    members.set(owner, [...(members.get(owner) ?? []), id])
  }
  return { nodes: outNodes, edges: outEdges, fees, members, expanded: true }
}

/** A run subset that names a use-case node names its inner nodes too. */
export function withUseCaseMembers(runNodeIds: ReadonlySet<string>, members: ReadonlyMap<string, readonly string[]>): ReadonlySet<string> {
  const out = new Set(runNodeIds)
  for (const [id, ids] of members) if (runNodeIds.has(id)) for (const m of ids) out.add(m)
  return out
}
