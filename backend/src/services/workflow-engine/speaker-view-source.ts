/**
 * Every source of a video-fed Speaker View is checked BEFORE anything charges
 * (decided 2026-10-12, R5; extends D18, and R2 for a node that opts in).
 *
 * The source's frame size (and whether it shows a face) comes from the same
 * cached clip measurement the node's own dispatch uses, so a run that is going
 * to be refused is refused for free:
 *
 *   - a source that EXISTS at run start (an Upload, a result saved on a node the
 *     run does not execute) is measured at run start, once, before any node
 *     dispatches (`speakerViewRunStartSourceCheck`);
 *   - a source the run PRODUCES (Generate Video, Trim) is awaited by every paid
 *     node that feeds the Speaker View — the level builder orders them after it
 *     (`speakerViewSourceOrderingEdges`) — and is measured the moment it
 *     exists, before the first of them dispatches (`speakerViewDispatchGate`):
 *     Transcribe waits until the source exists and is checked, then runs.
 *
 * The Speaker View's own dispatch keeps its checks (`speakerViewVideoEdit`) as
 * the backstop.
 */
import { speakerViewSourceRefusal, speakerViewVideoModeLive } from "@nodaro/render-rules"
import { ClipMeasureError, measureClip, type MeasuredClip } from "../../lib/clip-measure.js"
import { resolveNodeInputs } from "./input-resolver.js"
import { ancestorsOf, videoFedSpeakerViews, type VideoFedSpeakerView } from "./speaker-view-source-graph.js"
import type { NodeExecutionState, SimpleEdge, SimpleNode } from "./types.js"

export { speakerViewSourceOrderingEdges, videoFedSpeakerViews, type VideoFedSpeakerView } from "./speaker-view-source-graph.js"

export interface SpeakerViewSourceDeps {
  readonly measure: (url: string) => Promise<MeasuredClip>
  /** Whether video mode may run (R15); while it may not, the run-start gate refuses it and nothing is measured here. */
  readonly videoModeLive: () => boolean
}

const defaultDeps: SpeakerViewSourceDeps = { measure: (url) => measureClip(url), videoModeLive: () => speakerViewVideoModeLive() }

/** One measurement per address for as long as the map lives. */
function measuredOnce(deps: SpeakerViewSourceDeps, memo: Map<string, Promise<MeasuredClip>>): (url: string) => Promise<MeasuredClip> {
  return (url) => {
    let p = memo.get(url)
    if (!p) {
      p = deps.measure(url)
      memo.set(url, p)
    }
    return p
  }
}

/** What the clip's facts refuse for this node, as a sentence naming it; null when it may run. */
async function refusalFor(view: VideoFedSpeakerView, url: string, measure: (url: string) => Promise<MeasuredClip>): Promise<string | null> {
  let clip: MeasuredClip
  try {
    clip = await measure(url)
  } catch (err) {
    if (err instanceof ClipMeasureError) return `${err.message} (Speaker View node "${view.label}").`
    throw err
  }
  return speakerViewSourceRefusal(view, clip)
}

function videoUrlOf(
  view: VideoFedSpeakerView,
  nodes: SimpleNode[],
  edges: SimpleEdge[],
  nodeStates: Record<string, NodeExecutionState>,
  triggerData?: Record<string, unknown>,
): string | undefined {
  const sv = nodes.find((n) => n.id === view.id)
  if (!sv) return undefined
  const url = resolveNodeInputs(sv, edges, nodeStates, nodes, triggerData).videoUrl
  return typeof url === "string" && url.trim() ? url.trim() : undefined
}

/**
 * Run start: the refusal for the video-fed Speaker Views this run executes
 * whose source already exists, or null. One measurement per address. A source
 * the run has yet to produce is left to the dispatch gate.
 */
export async function speakerViewRunStartSourceCheck(input: {
  readonly runNodes: SimpleNode[]
  readonly nodes: SimpleNode[]
  readonly edges: SimpleEdge[]
  readonly nodeStates: Record<string, NodeExecutionState>
  readonly triggerData?: Record<string, unknown>
  readonly deps?: SpeakerViewSourceDeps
}): Promise<string | null> {
  const deps = input.deps ?? defaultDeps
  if (!deps.videoModeLive()) return null
  const running = new Set(input.runNodes.map((n) => n.id))
  const measure = measuredOnce(deps, new Map())
  const messages: string[] = []
  for (const view of videoFedSpeakerViews(input.nodes, input.edges)) {
    if (!running.has(view.id)) continue
    if (input.nodeStates[view.videoSourceId]?.status !== "completed") continue
    const url = videoUrlOf(view, input.nodes, input.edges, input.nodeStates, input.triggerData)
    if (!url) continue
    const message = await refusalFor(view, url, measure)
    if (message) messages.push(message)
  }
  return messages.length === 0 ? null : `${messages.join(" ")} The run did not start and nothing was charged.`
}

/** One measurement per address per run (keyed by the run's own state record). */
const gateMeasurements = new WeakMap<object, Map<string, Promise<MeasuredClip>>>()

/**
 * Dispatch: called before a node runs. A node that feeds a video-fed Speaker
 * View (and is not the source or upstream of it) is refused here when the
 * source now exists and the clip's own facts refuse it, before it reserves or
 * charges anything. A source with no output yet cannot be looked at; the
 * Speaker View's own dispatch judges it. `runNodeIds` is the set of nodes the
 * run executes (absent: every Speaker View is judged); a Speaker View outside
 * it is left alone.
 */
export async function speakerViewDispatchGate(
  node: SimpleNode,
  allNodes: SimpleNode[],
  edges: SimpleEdge[],
  nodeStates: Record<string, NodeExecutionState>,
  deps: SpeakerViewSourceDeps = defaultDeps,
  triggerData?: Record<string, unknown>,
  runNodeIds?: ReadonlySet<string>,
): Promise<void> {
  if (node.type === "speaker-view" || !allNodes.some((n) => n.type === "speaker-view")) return
  if (!deps.videoModeLive()) return
  const views = videoFedSpeakerViews(allNodes, edges)
  if (views.length === 0) return
  let memo = gateMeasurements.get(nodeStates)
  if (!memo) {
    memo = new Map()
    gateMeasurements.set(nodeStates, memo)
  }
  const measure = measuredOnce(deps, memo)
  for (const view of views) {
    // Only a Speaker View this run executes can be refused here: a partial run
    // (Run selected, Run from here, up to a node) that leaves it out must not
    // be blocked, or trigger a face-detect download, on its account. An unknown
    // run set (a nested graph, which runs whole) judges every view.
    if (runNodeIds && !runNodeIds.has(view.id)) continue
    if (view.videoSourceId === node.id) continue
    if (!ancestorsOf(view.id, edges).has(node.id) || ancestorsOf(view.videoSourceId, edges).has(node.id)) continue
    if (nodeStates[view.videoSourceId]?.status !== "completed") continue
    const url = videoUrlOf(view, allNodes, edges, nodeStates, triggerData)
    if (!url) continue
    const message = await refusalFor(view, url, measure)
    if (message) throw new Error(`${message} Nothing that feeds it was run or charged.`)
  }
}
