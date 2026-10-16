/**
 * What a use-case wrapper job reports (its `output_data`), read from the
 * inner run's node states through the graph's outputMap. Pure.
 *
 * - media: the outputMap's media node when it completed; otherwise the render
 *   (a review-on run stops at the proxy render and gates what follows it).
 * - json: the plan (the effective EDL, review edits applied — a Render final
 *   seeds the plan with them); transcript: the transcript.
 * - a failed run keeps the completed outputs and names the failed step in the
 *   user's words (the node's label).
 * - the take's stamps: the render's `planBasis` / `renderBasis` (what a
 *   hand-built render's take carries, so the review can tell whether the take
 *   shows the plan and settings it holds now), and the settings the run was
 *   built from (`useCaseSettings`, the stored snapshot's): a Render final
 *   renders with THOSE, never the node's later ones (decided 2026-10-13).
 * - the episode's length (`durationSec`), when the run knows it: the length
 *   its media node hands on, read as the step after the node is charged
 *   (`runForwardedVideoLengthSec`) — the cut its render recorded, through the
 *   captions and the music mix and merge that keep it (decided 2026-10-16).
 */
import { runForwardedVideoLengthSec, type RunOutputLengths, type StoredInlineGraph } from "@nodaro/render-rules"

export interface UseCaseWrapperOutput {
  readonly videoUrl?: string
  readonly audioUrl?: string
  readonly json?: unknown
  readonly plan?: unknown
  readonly transcript?: unknown
  readonly quality: "proxy" | "final"
  readonly planBasis?: string
  readonly renderBasis?: string
  readonly useCaseSettings?: Readonly<Record<string, unknown>>
  /** The episode's length, in seconds, when the run knows it. */
  readonly durationSec?: number
  readonly _executionId: string
  readonly failedNodeId?: string
  readonly failedStep?: string
}

type State = { readonly status?: unknown; readonly output?: Readonly<Record<string, unknown>> }

const completedOutput = (
  states: Readonly<Record<string, unknown>>,
  id: string,
): Readonly<Record<string, unknown>> | undefined => {
  const s = states[id] as State | undefined
  return s?.status === "completed" ? s.output : undefined
}
const str = (v: unknown): string | undefined => (typeof v === "string" && v.length > 0 ? v : undefined)
const isRecord = (v: unknown): v is Readonly<Record<string, unknown>> => !!v && typeof v === "object" && !Array.isArray(v)

export function usecaseWrapperOutput(
  graph: StoredInlineGraph,
  nodeStates: Readonly<Record<string, unknown>>,
  executionId: string,
): UseCaseWrapperOutput {
  const map = graph.outputMap
  const mediaNodeId = completedOutput(nodeStates, map.media.nodeId) ? map.media.nodeId : map.renderNodeId
  const media = completedOutput(nodeStates, mediaNodeId)
  const render = completedOutput(nodeStates, map.renderNodeId)
  const planOut = completedOutput(nodeStates, map.planNodeId)
  const transcriptOut = completedOutput(nodeStates, map.transcript.nodeId)
  const renderData = graph.nodes.find((n) => n.id === map.renderNodeId)?.data ?? {}
  const quality = (render?.quality ?? renderData.quality) === "proxy" ? "proxy" : "final"
  const failed = graph.nodes.find((n) => (nodeStates[n.id] as State | undefined)?.status === "failed")
  const videoUrl = str(media?.videoUrl)
  const audioUrl = videoUrl ? undefined : str(media?.audioUrl)
  // The node that delivered the episode is this run's: its own length, else the length it keeps.
  const durationSec = videoUrl || audioUrl
    ? runForwardedVideoLengthSec(mediaNodeId, undefined, graph.nodes, graph.edges, (id) => completedOutput(nodeStates, id) as RunOutputLengths | undefined)
    : undefined
  return {
    ...(videoUrl ? { videoUrl } : {}),
    ...(audioUrl ? { audioUrl } : {}),
    ...(planOut?.json !== undefined ? { json: planOut.json, plan: planOut.json } : {}),
    ...(transcriptOut?.json !== undefined ? { transcript: transcriptOut.json } : {}),
    quality,
    ...(str(render?.planBasis) ? { planBasis: str(render?.planBasis) } : {}),
    ...(str(render?.renderBasis) ? { renderBasis: str(render?.renderBasis) } : {}),
    ...(isRecord(graph.settings) ? { useCaseSettings: graph.settings } : {}),
    ...(durationSec !== undefined ? { durationSec } : {}),
    _executionId: executionId,
    ...(failed ? { failedNodeId: failed.id, failedStep: str(failed.data.label) ?? failed.type } : {}),
  }
}
