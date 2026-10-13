/**
 * Every source of a video-fed Speaker View is checked BEFORE anything charges
 * (decided 2026-10-12, R5; extends D18, and R2 for a node that opts in), in the
 * editor's engine as the server's.
 *
 * The source's frame size (and whether it shows a face) comes from the cached
 * background clip measurement (`measureClipLength`, R4), so a run that is going
 * to be refused is refused for free:
 *
 *   - a source that EXISTS at run start (an Upload, a result saved on a node the
 *     run does not execute) is measured in the run funnel, once, before the run
 *     is sent (`speakerViewRunStartSourceCheck`);
 *   - a source the run PRODUCES (Generate Video, Trim) is awaited by every paid
 *     node that feeds the Speaker View — the level builder orders them after it
 *     (`speakerViewSourceOrderingEdges`) — and is measured the moment it exists,
 *     before the first of them dispatches (`speakerViewDispatchGate`): Transcribe
 *     waits until the source exists and is checked, then runs. This half is for
 *     the one place the editor runs a multi-node graph itself, a Sub-workflow
 *     node; every other multi-node run is the server's, which asks the same rule.
 *
 * The graph rule and the sentence are `@nodaro/render-rules`' (the very ones the
 * orchestrator uses). The Speaker View's own executor keeps its checks as the
 * backstop.
 */
import { ancestorsOf, speakerViewSourceRefusal, speakerViewVideoModeLive, videoFedSpeakerViews, type SpeakerViewClipFacts, type VideoFedSpeakerView } from "@nodaro/render-rules"
import { ClipMeasureStopped } from "@/lib/clip-measure-poll"

type GraphNode = { readonly id: string; readonly type?: unknown; readonly data?: unknown }
type GraphEdge = { readonly id?: string; readonly source: string; readonly target: string; readonly targetHandle?: string | null }

export type MeasureClip = (url: string) => Promise<SpeakerViewClipFacts>

/** One measurement per address for as long as the returned function lives. */
export function memoizedMeasure(measure: MeasureClip): MeasureClip {
  const seen = new Map<string, Promise<SpeakerViewClipFacts>>()
  return (url) => {
    let p = seen.get(url)
    if (!p) {
      p = measure(url)
      seen.set(url, p)
    }
    return p
  }
}

/** What the clip's facts refuse for this node, as a sentence naming it; null when it may run. A Stop or a restarted run is rethrown, never a refusal. */
async function refusalFor(view: VideoFedSpeakerView, url: string, measure: MeasureClip): Promise<string | null> {
  let clip: SpeakerViewClipFacts
  try {
    clip = await measure(url)
  } catch (err) {
    if (err instanceof ClipMeasureStopped) throw err
    const message = err instanceof Error ? err.message : String(err)
    return `${message} (Speaker View node "${view.label}").`
  }
  return speakerViewSourceRefusal(view, clip)
}

/**
 * Run start: the refusal for the video-fed Speaker Views this run executes whose
 * source already exists, or null. One measurement per address. A source the run
 * has yet to produce is left to the dispatch gate (and to the server's).
 *
 * `urlOf` is the address the view's wired video resolves to on the canvas,
 * undefined while its producer has none.
 */
export async function speakerViewRunStartSourceCheck(input: {
  readonly executing: ReadonlyArray<GraphNode>
  readonly nodes: ReadonlyArray<GraphNode>
  readonly edges: ReadonlyArray<GraphEdge>
  readonly urlOf: (speakerViewId: string) => string | undefined
  readonly measure: MeasureClip
  /** Whether video mode may run (R15); the default is the one predicate. While it
   *  may not, the run gate refuses it and nothing is measured here. */
  readonly videoModeLive?: boolean
}): Promise<string | null> {
  if (!(input.videoModeLive ?? speakerViewVideoModeLive())) return null
  const running = new Set(input.executing.map((n) => n.id))
  const measure = memoizedMeasure(input.measure)
  const messages: string[] = []
  for (const view of videoFedSpeakerViews(input.nodes, input.edges)) {
    if (!running.has(view.id)) continue
    if (running.has(view.videoSourceId)) continue
    const url = input.urlOf(view.id)
    if (!url) continue
    const message = await refusalFor(view, url, measure)
    if (message) messages.push(message)
  }
  return messages.length === 0 ? null : `${messages.join(" ")} The run did not start and nothing was charged.`
}

/**
 * Dispatch: called before a node runs. A node that feeds a video-fed Speaker
 * View (and is not the source or upstream of it) is refused here when the source
 * now exists and the clip's own facts refuse it, before it charges anything. A
 * source with no output yet cannot be looked at; the Speaker View's own
 * dispatch judges it.
 *
 * `sourceReady` says whether the source node's output is the one this run
 * uses (an Upload, or a producer that has finished in this run). Pass a
 * `memoizedMeasure` shared across the run's dispatches for one measurement per
 * address.
 */
export async function speakerViewDispatchGate(input: {
  readonly node: GraphNode
  readonly nodes: ReadonlyArray<GraphNode>
  readonly edges: ReadonlyArray<GraphEdge>
  readonly sourceReady: (sourceId: string) => boolean
  readonly urlOf: (speakerViewId: string) => string | undefined
  readonly measure: MeasureClip
  readonly videoModeLive?: boolean
}): Promise<void> {
  const { node, nodes, edges } = input
  if (node.type === "speaker-view") return
  if (!(input.videoModeLive ?? speakerViewVideoModeLive())) return
  const views = videoFedSpeakerViews(nodes, edges)
  for (const view of views) {
    if (view.videoSourceId === node.id) continue
    if (!ancestorsOf(view.id, edges).has(node.id) || ancestorsOf(view.videoSourceId, edges).has(node.id)) continue
    if (!input.sourceReady(view.videoSourceId)) continue
    const url = input.urlOf(view.id)
    if (!url) continue
    const message = await refusalFor(view, url, input.measure)
    if (message) throw new Error(`${message} Nothing that feeds it was run or charged.`)
  }
}
