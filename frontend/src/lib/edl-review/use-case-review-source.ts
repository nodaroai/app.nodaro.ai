/**
 * The review inputs a use-case node (Tighten Episode, decided 2026-10-13)
 * carries itself: its hidden run's plan (`generatedJson`), the reviewer's edit
 * of it (`editedEdl`, written by the same `writeReview`), the run's transcript
 * (`generatedTranscript`), and the render that run used. The second source of
 * the one review model; an Edit Plan feeding a render on the canvas is the
 * first.
 *
 * So that the second source is read exactly as the first, it is handed to the
 * review as that very pair (`usecaseReviewView`): the chain the run of the take
 * on show built (its type's @nodaro/render-rules descriptor `build`, from the
 * settings that run kept on its take), cut down to the recording, the transcript,
 * the plan and the render, with the node's own values on them. A multicam
 * take (decided 2026-10-17) keeps every recording its plan reads, the Master
 * audio, and Camera Switch between the plan and the render — never Speaker
 * Map or Audio Sync. The plan IS
 * the node (same id), so the review's edit is written to the node. The render
 * is the run's own type and settings — Apply EDL, or Speaker View when the
 * episode is framed — so its own review adapter, rule and basis answer, and
 * no render type is named here.
 *
 * A list-driven node (one run per item) has no single run to review.
 */
import { editPlanBasis } from "@nodaro/shared/edl"
import { isRenderNodeType } from "@nodaro/shared/nodes"
import {
  MULTICAM_NODE_IDS,
  isUseCaseNodeType,
  usecaseDescriptor,
  usecaseFramingForViewer,
  usecaseRecordingsKind,
  usecaseRenameInnerIds,
  usecaseRenderNodeId,
  usecaseRunMaxRecordings,
  type UseCaseGraph,
  type UseCaseMediaSource,
  type UseCaseNodeType,
  type UseCaseSources,
} from "@nodaro/render-rules"
import { resolveNodeInputs } from "@/components/editor/workflow-editor/node-input-resolver"
import { usecaseListDriven } from "@/components/editor/workflow-editor/use-case-render-final-set"
import { usecaseRunSettings, usecaseTakeOnShow } from "@/lib/use-case-run-result"
import { usecaseMulticamOffered } from "@/lib/use-case-multicam-viewer"
import { usecaseFramesOffered } from "@/lib/use-case-frames-viewer"
import { usecaseCarriedWires } from "@/lib/use-case-wired-recordings"
import type { WorkflowEdge, WorkflowNode } from "@/types/nodes"
import { planKindOf } from "./plan-kind"

type GraphNode = { readonly id: string; readonly type?: string | null; readonly data?: unknown }
type GraphEdge = { readonly source: string; readonly target: string; readonly sourceHandle?: string | null; readonly targetHandle?: string | null }

export interface UseCaseReviewSource {
  /** The node itself: it holds the plan and its edit. */
  readonly planId: string
  readonly plan: unknown
  readonly editedEdl: unknown
  readonly transcript: unknown
  /** The render the node's run uses, a render-registry id (Speaker View when the episode is framed). */
  readonly renderType: string
  /** That render's settings, as the run builds them. */
  readonly render: Readonly<Record<string, unknown>>
  /** The recording wired into the node, as the canvas resolves it; undefined when none is. */
  readonly recordingUrl: string | undefined
}

/** The pair a review of a use-case node reads: the canvas's shape, the render's id in it. */
export interface UseCaseReviewView<N, E> {
  readonly renderId: string
  readonly nodes: N[]
  readonly edges: E[]
}

const dataOf = (n: GraphNode | undefined): Readonly<Record<string, unknown>> => (n?.data ?? {}) as Readonly<Record<string, unknown>>

/** Can use-case node `nodeId` be reviewed: a reviewable type, one run's plan of the kind its inspector edits. */
export function usecaseReviewable(nodeId: string, nodes: readonly GraphNode[], edges: readonly GraphEdge[]): boolean {
  const node = nodes.find((n) => n.id === nodeId)
  if (!node || !isUseCaseNodeType(node.type ?? undefined)) return false
  const d = usecaseDescriptor(node.type as UseCaseNodeType)
  if (!d.reviewable) return false
  if (planKindOf(dataOf(node).generatedJson) !== (d.resultKind === "clips" ? "clips" : "edl")) return false
  return !usecaseListDriven(node as WorkflowNode, nodes as WorkflowNode[], edges as WorkflowEdge[])
}

/** A stored transcript as a value (a run may hand it on as JSON text). */
function transcriptValue(v: unknown): unknown {
  if (typeof v !== "string") return v
  try {
    return JSON.parse(v)
  } catch {
    return undefined
  }
}

/** The last chain built per settings object: the review reads it several times per canvas change. */
const chains = new WeakMap<object, { readonly key: string; readonly chain: UseCaseGraph }>()

/**
 * What the run of the take on show read: its settings (kept on the take; the
 * node's own for a take that kept none — decided 2026-10-13: a review reads
 * the PREVIEW's settings, never the node's later ones), and the recordings and
 * Master audio wired into the node, as many as that run read. A take whose
 * run kept settings says whether it was multicam (a multicam run's settings
 * carry `cameras`, and only those); a take that kept none is read as this
 * viewer's run would read it (`usecaseMulticamOffered`).
 */
function takeInputs(node: GraphNode, nodes: readonly GraphNode[], edges: readonly GraphEdge[]): { readonly raw: Readonly<Record<string, unknown>>; readonly sources: UseCaseSources; readonly multicam: boolean } {
  const data = dataOf(node)
  const kept = usecaseRunSettings(data)
  const d = usecaseDescriptor(node.type as UseCaseNodeType)
  const multicam = d.maxRecordings > 1 && (kept ? "cameras" in kept : usecaseMulticamOffered())
  const resolved = resolveNodeInputs(node as WorkflowNode, nodes as WorkflowNode[], edges as WorkflowEdge[])
  // The canvas resolver keys each file by the node it carries; the one wire reader names that node (`origin`).
  const urls = new Map((resolved.useCaseMedia ?? []).map((m) => [m.nodeId, m.url]))
  // The run's rule: a wire whose node holds no file yet is skipped (the resolver hands the run none), the next one read.
  const wires = usecaseCarriedWires(node, usecaseRunMaxRecordings(d.maxRecordings, multicam), nodes, edges, { readable: (w) => urls.has(w.origin) })
  const recordings: UseCaseMediaSource[] = wires.recordings.map((w) => ({ url: urls.get(w.origin)!, kind: w.kind }))
  const masterId = multicam && d.inputs.includes("masterAudio") ? wires.master?.nodeId : undefined
  const media = recordings[0] ?? { url: "", kind: "video" as const }
  return {
    // A take that kept none reads the framing source as this viewer's run would (`usecaseFramingForViewer`).
    raw: kept ?? usecaseFramingForViewer(data, usecaseFramesOffered()),
    sources: {
      media,
      ...(recordings.length > 1 ? { moreMedia: recordings.slice(1) } : {}),
      ...(masterId && resolved.useCaseMasterAudio ? { masterAudio: { url: resolved.useCaseMasterAudio, kind: "audio" as const } } : {}),
    },
    multicam: recordings.length > 1 || (!!masterId && !!resolved.useCaseMasterAudio),
  }
}

/** The chain the run of the take on show built (see `takeInputs`), on what the node has wired. */
function builtChain(node: GraphNode, nodes: readonly GraphNode[], edges: readonly GraphEdge[]): UseCaseGraph {
  const { raw, sources, multicam } = takeInputs(node, nodes, edges)
  const recordings = [sources.media, ...(sources.moreMedia ?? [])]
  const kind = usecaseRecordingsKind(recordings.map((r) => r.kind)) ?? "video"
  const key = JSON.stringify([kind, recordings.map((r) => [r.url, r.kind]), sources.masterAudio?.url ?? null])
  const held = chains.get(raw)
  if (held?.key === key) return held.chain
  const d = usecaseDescriptor(node.type as UseCaseNodeType)
  // One recording reads its settings and builds exactly as before multicam.
  const settings = multicam ? d.resolveSettings(raw, kind, { recordings: recordings.length, masterAudio: !!sources.masterAudio }) : d.resolveSettings(raw, kind)
  const chain = d.build(settings, multicam ? sources : { media: sources.media })
  chains.set(raw, { key, chain })
  return chain
}

/** The review inputs use-case node `nodeId` carries; null when it cannot be reviewed. */
export function usecaseReviewSource(nodeId: string, nodes: readonly GraphNode[], edges: readonly GraphEdge[]): UseCaseReviewSource | null {
  if (!usecaseReviewable(nodeId, nodes, edges)) return null
  const node = nodes.find((n) => n.id === nodeId)!
  const d = dataOf(node)
  // The recording the run reads first: the node's order (the run's own rule), its file by the node it carries.
  const resolved = resolveNodeInputs(node as WorkflowNode, nodes as WorkflowNode[], edges as WorkflowEdge[]).useCaseMedia ?? []
  const first = usecaseCarriedWires(node, 1, nodes, edges, { readable: (w) => resolved.some((m) => m.nodeId === w.origin) }).recordings[0]
  const recordingUrl = (first && resolved.find((m) => m.nodeId === first.origin)?.url) || undefined
  const chain = builtChain(node, nodes, edges)
  const renderId = usecaseRenderNodeId(chain.outputMap)
  if (!renderId) return null
  const render = chain.nodes.find((n) => n.id === renderId)
  if (!render || !isRenderNodeType(render.type)) return null
  return {
    planId: nodeId,
    plan: d.generatedJson,
    editedEdl: d.editedEdl,
    transcript: transcriptValue(d.generatedTranscript),
    renderType: render.type,
    render: render.data,
    recordingUrl,
  }
}

/**
 * The review of `renderId` as the review reads it: the canvas itself for a
 * render, and for a reviewable use-case node the pair its run is (see the
 * module note) — the recording, its transcript, the plan (the node, under its
 * own id) and the run's render, wired as the chain wires them.
 */
export function usecaseReviewView<N extends GraphNode, E extends GraphEdge>(
  renderId: string,
  nodes: readonly N[],
  edges: readonly E[],
): UseCaseReviewView<N, E> | null {
  const source = usecaseReviewSource(renderId, nodes, edges)
  if (!source) return null
  const node = nodes.find((n) => n.id === renderId)!
  const chain = builtChain(node, nodes, edges)
  const renderNodeId = usecaseRenderNodeId(chain.outputMap)
  if (!renderNodeId) return null
  const { planNodeId, transcript } = chain.outputMap
  // What sits between the plan and the render (a multicam run's Camera Switch)
  // is kept; Speaker Map (and the wire the canvas withholds) and Audio Sync are not reviewed.
  const after = reachable(planNodeId, chain.edges, "down")
  const before = reachable(renderNodeId, chain.edges, "up")
  const keep = new Set([planNodeId, renderNodeId, transcript.nodeId, ...[...after].filter((id) => before.has(id))])
  const unreviewed = new Set<string>([MULTICAM_NODE_IDS.map, MULTICAM_NODE_IDS.sync])
  for (const e of chain.edges) if (keep.has(e.target) && e.target !== transcript.nodeId && !keep.has(e.source) && !unreviewed.has(e.source)) keep.add(e.source)
  const idOf = (id: string) => (id === planNodeId ? renderId : `${renderId}::${id}`)
  const own: Readonly<Record<string, Readonly<Record<string, unknown>>>> = {
    [planNodeId]: { generatedJson: source.plan, editedEdl: source.editedEdl },
    ...(source.transcript !== undefined && source.transcript !== null ? { [transcript.nodeId]: { generatedJson: source.transcript } } : {}),
  }
  // Node ids named inside data (the plan's source order and roles, the switch's override) follow the renaming.
  const builtIds = new Set(chain.nodes.map((n) => n.id))
  const renamed = (data: Readonly<Record<string, unknown>>) => usecaseRenameInnerIds(data, idOf, builtIds)
  const pairNodes = chain.nodes
    .filter((n) => keep.has(n.id))
    .map((n) => ({ ...n, id: idOf(n.id), data: { ...renamed(n.data), ...own[n.id] } }) as unknown as N)
  const pairEdges = chain.edges
    .filter((e) => keep.has(e.source) && keep.has(e.target))
    .map((e) => ({ ...e, id: `${renderId}::${e.id}`, source: idOf(e.source), target: idOf(e.target) }) as unknown as E)
  return { renderId: idOf(renderNodeId), nodes: pairNodes, edges: pairEdges }
}

/** Every node reachable from `from` along the chain's wires, downstream or upstream (`from` itself excluded). */
function reachable(from: string, edges: readonly { readonly source: string; readonly target: string }[], way: "down" | "up"): Set<string> {
  const seen = new Set<string>()
  const queue = [from]
  while (queue.length > 0) {
    const id = queue.pop()!
    for (const e of edges) {
      const next = way === "down" ? (e.source === id ? e.target : undefined) : (e.target === id ? e.source : undefined)
      if (next !== undefined && next !== from && !seen.has(next)) {
        seen.add(next)
        queue.push(next)
      }
    }
  }
  return seen
}

/** What a review of `renderId` reads: a use-case node's pair, else the canvas as it is. */
export function reviewViewOf<N extends GraphNode, E extends GraphEdge>(
  renderId: string,
  nodes: readonly N[],
  edges: readonly E[],
): UseCaseReviewView<N, E> {
  return usecaseReviewView(renderId, nodes, edges) ?? { renderId, nodes: [...nodes], edges: [...edges] }
}

/**
 * Whether the node's review edit was made on the plan of ANOTHER take of the
 * node (a gallery pick showed an older take), rather than on an earlier plan:
 * that edit is someone's work on a take still there, so the review says so,
 * and asks before it is discarded or replaced (decided 2026-10-13).
 */
export function usecaseEditOfOtherTake(data: Readonly<Record<string, unknown>>, editedEdl: unknown): boolean {
  const basis = (editedEdl as { basis?: unknown } | null | undefined)?.basis
  if (typeof basis !== "string" || basis === "") return false
  const shown = usecaseTakeOnShow(data)
  const takes = Array.isArray(data.generatedResults) ? (data.generatedResults as Array<Record<string, unknown>>) : []
  return takes.some((t) => t !== shown && t?.generatedJson !== undefined && t.generatedJson !== null && editPlanBasis(t.generatedJson) === basis)
}
