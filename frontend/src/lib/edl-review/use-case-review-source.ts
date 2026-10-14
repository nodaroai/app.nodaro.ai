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
 * on show built (@nodaro/render-rules `buildTightenEpisodeGraph`, from the
 * settings that run kept on its take), cut down to the recording, the transcript,
 * the plan and the render, with the node's own values on them. The plan IS
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
  buildTightenEpisodeGraph,
  isUseCaseNodeType,
  resolveTightenEpisodeSettings,
  usecaseMediaKindOf,
  type UseCaseGraph,
} from "@nodaro/render-rules"
import { resolveNodeInputs } from "@/components/editor/workflow-editor/node-input-resolver"
import { usecaseListDriven } from "@/components/editor/workflow-editor/use-case-render-final-set"
import { usecaseRunSettings, usecaseTakeOnShow } from "@/lib/use-case-run-result"
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

/** Can use-case node `nodeId` be reviewed: a single run's Tighten EDL on it. */
export function usecaseReviewable(nodeId: string, nodes: readonly GraphNode[], edges: readonly GraphEdge[]): boolean {
  const node = nodes.find((n) => n.id === nodeId)
  if (!node || !isUseCaseNodeType(node.type ?? undefined)) return false
  if (planKindOf(dataOf(node).generatedJson) !== "edl") return false
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
 * The chain the run of the take on show built: from the settings that run was
 * built from (kept on the take; the node's own for a take that kept none —
 * decided 2026-10-13: a review reads the PREVIEW's settings, never the node's
 * later ones) and the recording wired into the node.
 */
function builtChain(node: GraphNode, nodes: readonly GraphNode[], edges: readonly GraphEdge[], recordingUrl: string | undefined): UseCaseGraph {
  const wire = edges.find((e) => e.target === node.id && e.targetHandle === "media")
  const kind = usecaseMediaKindOf(nodes.find((n) => n.id === wire?.source), wire?.sourceHandle)
  const raw = usecaseRunSettings(dataOf(node)) ?? dataOf(node)
  const key = `${kind}\u0000${recordingUrl ?? ""}`
  const held = chains.get(raw)
  if (held?.key === key) return held.chain
  const chain = buildTightenEpisodeGraph(resolveTightenEpisodeSettings(raw, kind), { media: { url: recordingUrl ?? "", kind } })
  chains.set(raw, { key, chain })
  return chain
}

/** The review inputs use-case node `nodeId` carries; null when it cannot be reviewed. */
export function usecaseReviewSource(nodeId: string, nodes: readonly GraphNode[], edges: readonly GraphEdge[]): UseCaseReviewSource | null {
  if (!usecaseReviewable(nodeId, nodes, edges)) return null
  const node = nodes.find((n) => n.id === nodeId)!
  const d = dataOf(node)
  const media = resolveNodeInputs(node as WorkflowNode, nodes as WorkflowNode[], edges as WorkflowEdge[]).useCaseMedia?.[0]
  const recordingUrl = media?.url || undefined
  const chain = builtChain(node, nodes, edges, recordingUrl)
  const render = chain.nodes.find((n) => n.id === chain.outputMap.renderNodeId)
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
  const chain = builtChain(node, nodes, edges, source.recordingUrl)
  const { planNodeId, renderNodeId, transcript } = chain.outputMap
  const keep = new Set([planNodeId, renderNodeId, transcript.nodeId])
  for (const e of chain.edges) if (keep.has(e.target) && e.target !== transcript.nodeId && !keep.has(e.source)) keep.add(e.source)
  const idOf = (id: string) => (id === planNodeId ? renderId : `${renderId}::${id}`)
  const own: Readonly<Record<string, Readonly<Record<string, unknown>>>> = {
    [planNodeId]: { generatedJson: source.plan, editedEdl: source.editedEdl },
    ...(source.transcript !== undefined && source.transcript !== null ? { [transcript.nodeId]: { generatedJson: source.transcript } } : {}),
  }
  // Node ids named inside data (the plan's source order) follow the renaming.
  const renamed = (data: Readonly<Record<string, unknown>>) =>
    Array.isArray(data.sourceOrder) ? { ...data, sourceOrder: (data.sourceOrder as string[]).map(idOf) } : data
  const pairNodes = chain.nodes
    .filter((n) => keep.has(n.id))
    .map((n) => ({ ...n, id: idOf(n.id), data: { ...renamed(n.data), ...own[n.id] } }) as unknown as N)
  const pairEdges = chain.edges
    .filter((e) => keep.has(e.source) && keep.has(e.target))
    .map((e) => ({ ...e, id: `${renderId}::${e.id}`, source: idOf(e.source), target: idOf(e.target) }) as unknown as E)
  return { renderId: idOf(renderNodeId), nodes: pairNodes, edges: pairEdges }
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
