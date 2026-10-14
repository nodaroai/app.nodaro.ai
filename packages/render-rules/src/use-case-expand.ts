/**
 * A use-case node, for an ESTIMATE, is the chain it builds wired to its real
 * upstream source (decided 2026-10-13): every estimator — the backend run
 * estimate, the app listing, the editor — expands it with this one function
 * and prices the result with its ordinary rules, plus the node's fee. So the
 * one-node estimate is the hand-built chain's estimate by construction. Pure:
 * fresh objects, the inputs are never touched.
 *
 * Inner ids are `<nodeId>::<inner id>`. The built source (and music) node is
 * REPLACED by the node wired into `media` (and `music`), on that wire's
 * handle, so the plan's and the render's length read the real recording. An
 * unwired node keeps its placeholder source (unknown length: the ceiling).
 * Wires out of the node leave from the mapped output (`json` → the plan's
 * edit, `transcript` → the transcript, anything else → the media).
 *
 * A node that runs its Render final (`useCaseContinue: { mode: "render-final" }`,
 * an override of that run only) continues a run that paid its fee: it is
 * built — from the settings of that run when the continuation carries them
 * (`settings`, the preview's) — as the FINAL chain (review off, its render at final, its consumers
 * reading the episode), its members are its render and what follows it, and
 * it has no fee. Its earlier steps stay on the graph, unrun, for the render to
 * read — its plan holding the run's plan and the reviewer's edit, kept on the
 * node — so price it as a run subset.
 */
import { AUDIO_PRODUCER_TYPES, DYNAMIC_PRODUCER_TYPES } from "@nodaro/shared/nodes"
import { initialRunNodeIds, isUseCaseNodeType, usecaseFeeCreditId, type UseCaseFeeCreditId, type UseCaseGraph } from "./use-case-graph"
import { descendantsOf } from "./graph-walk"
import {
  TIGHTEN_NODE_IDS,
  buildTightenEpisodeGraph,
  resolveTightenEpisodeSettings,
  type UseCaseMediaKind,
} from "./tighten-episode-graph"

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
  /** Each use-case node's inner node ids that run (its replaced source excluded; a Render final: its render and what follows). */
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
}

const PLACEHOLDER_URL = "estimate://use-case-source"

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

/** The expansion of every use-case node on the graph (see the module note). */
export function expandUseCaseNodes<N extends AnyNode, E extends AnyEdge>(
  nodes: readonly N[],
  edges: readonly E[],
  options?: UseCaseExpandOptions,
): UseCaseExpansion<N, E> {
  const useCases = nodes.filter((n): n is N & { readonly id: string } => typeof n.id === "string" && isUseCaseNodeType(n.type))
  if (useCases.length === 0) return { nodes: [...nodes], edges: [...edges], fees: [], members: new Map(), expanded: false }

  const whole = options?.chain === "whole"
  const byId = new Map(nodes.flatMap((n) => (typeof n.id === "string" ? [[n.id, n] as const] : [])))
  const ucIds = new Set(useCases.map((u) => u.id))
  const wireInto = (id: string, handle: string) => edges.find((e) => e.target === id && e.targetHandle === handle && !!e.source)

  const built = new Map<string, UseCaseGraph>()
  const finals = new Set(useCases.filter((u) => runsUseCaseRenderFinal(u.data)).map((u) => u.id))
  for (const u of useCases) {
    const mediaWire = wireInto(u.id, "media")
    const kind = usecaseMediaKindOf(byId.get(mediaWire?.source ?? ""), mediaWire?.sourceHandle)
    const raw = (u.data ?? {}) as Readonly<Record<string, unknown>>
    // A Render final renders with the settings of the run it finishes (the
    // preview's, carried on the continuation), never the node's later ones.
    const settings = resolveTightenEpisodeSettings(finals.has(u.id) ? { ...(renderFinalSettingsOf(raw) ?? raw), reviewBeforeRender: false } : raw, kind)
    const music = wireInto(u.id, "music") ? { music: { url: PLACEHOLDER_URL } } : {}
    built.set(u.id, buildTightenEpisodeGraph(settings, { media: { url: PLACEHOLDER_URL, kind }, ...music }))
  }

  /** Where a wire leaving `nodeId` on `handle` really starts (through a use-case node's output map). */
  const from = (nodeId: string, handle: string | null): { source: string; sourceHandle: string | null } => {
    const g = built.get(nodeId)
    if (!g) return { source: nodeId, sourceHandle: handle }
    const { outputMap } = g
    // A review-on node delivers its preview until its Render final; a whole
    // chain keeps what follows the render, so its consumers read the media.
    const ref = handle === "json"
      ? outputMap.json
      : handle === "transcript"
        ? outputMap.transcript
        : !whole && initialRunNodeIds(g) ? outputMap.preview : outputMap.media
    return { source: inner(nodeId, ref.nodeId), sourceHandle: ref.handle }
  }

  const outNodes: Array<N | UseCaseExpandedNode> = nodes.filter((n) => !(typeof n.id === "string" && ucIds.has(n.id)))
  const outEdges: Array<E | UseCaseExpandedEdge> = []
  for (const e of edges) {
    if (ucIds.has(e.target)) continue // replaced by the inner wires below
    outEdges.push(e.source && ucIds.has(e.source) ? { ...e, ...from(e.source, e.sourceHandle ?? null) } : e)
  }

  const fees: Array<{ nodeId: string; creditId: UseCaseFeeCreditId }> = []
  const members = new Map<string, readonly string[]>()
  for (const u of useCases) {
    const g = built.get(u.id)!
    // A replaced source keeps the outer wire's data (its output mode, Each or
    // All): every inner step reads the source the way the node would have.
    const replaced = new Map<string, { source: string; sourceHandle: string | null; data?: unknown }>()
    const fromWire = (w: E) => ({ ...from(w.source!, w.sourceHandle ?? null), ...(w.data !== undefined ? { data: w.data } : {}) })
    const mediaWire = wireInto(u.id, "media")
    const musicWire = wireInto(u.id, "music")
    if (mediaWire) replaced.set(TIGHTEN_NODE_IDS.source, fromWire(mediaWire))
    if (musicWire) replaced.set(TIGHTEN_NODE_IDS.music, fromWire(musicWire))
    // Node ids named INSIDE data (the plan's sourceOrder; the mix's trackOrder
    // and duckUnder) follow the same renaming, or the plan would look for a
    // source that is not on the graph and price at the ceiling.
    const rename = (id: string) => replaced.get(id)?.source ?? inner(u.id, id)
    const renameData = (data: Readonly<Record<string, unknown>>): Record<string, unknown> => ({
      ...data,
      ...(Array.isArray(data.sourceOrder) ? { sourceOrder: (data.sourceOrder as string[]).map(rename) } : {}),
      ...(Array.isArray(data.trackOrder) ? { trackOrder: (data.trackOrder as string[]).map(rename) } : {}),
      ...(typeof data.duckUnder === "string" ? { duckUnder: rename(data.duckUnder) } : {}),
    })
    const firstRun = whole ? null : initialRunNodeIds(g)
    const runs = (id: string) => !firstRun || firstRun.includes(id)
    // A Render final runs its render and what follows it; the rest is read, not run.
    const final = finals.has(u.id)
    const finalPart = final ? new Set([g.outputMap.renderNodeId, ...descendantsOf(g.outputMap.renderNodeId, g.edges)]) : null
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
      const data = renameData(n.data)
      outNodes.push({ id: inner(u.id, n.id), type: n.type, data: n.id === g.outputMap.planNodeId ? { ...data, ...planResult } : data })
    }
    for (const e of g.edges) {
      if (!runs(e.target) || (!replaced.has(e.source) && !runs(e.source))) continue
      const start = replaced.get(e.source) ?? { source: inner(u.id, e.source), sourceHandle: e.sourceHandle }
      outEdges.push({ ...start, target: inner(u.id, e.target), targetHandle: e.targetHandle })
    }
    if (!final) fees.push({ nodeId: u.id, creditId: usecaseFeeCreditId(g.nodeType) })
    members.set(u.id, ids)
  }
  return { nodes: outNodes, edges: outEdges, fees, members, expanded: true }
}

/** A run subset that names a use-case node names its inner nodes too. */
export function withUseCaseMembers(runNodeIds: ReadonlySet<string>, members: ReadonlyMap<string, readonly string[]>): ReadonlySet<string> {
  const out = new Set(runNodeIds)
  for (const [id, ids] of members) if (runNodeIds.has(id)) for (const m of ids) out.add(m)
  return out
}
