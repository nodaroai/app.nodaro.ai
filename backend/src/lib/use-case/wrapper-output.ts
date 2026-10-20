/**
 * What a use-case wrapper job reports (its `output_data`), read from the
 * inner run's node states through the graph's outputMap, by the result its
 * kind promises — an episode here, a layout (the framed recording) in
 * wrapper-output-layout.ts, a list (clips, formats) or chapters in
 * wrapper-output-lists.ts (with why a completed run delivered nothing). Pure.
 *
 * An episode:
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
 * - a run on several recordings or a Master audio: its cameras report
 *   (`cameras`, wrapper-output-cameras.ts), for an episode and a list alike.
 */
import {
  runForwardedVideoLengthSec,
  usecasePlanNodeId,
  usecaseResultKind,
  type EpisodeOutputMap,
  type RunOutputLengths,
  type StoredInlineGraph,
} from "@nodaro/render-rules"
import { completedOutput, failedStepOf, isRecord, str, type UseCaseWrapperOutput } from "./wrapper-output-parts.js"
import { listOutput } from "./wrapper-output-lists.js"
import { layoutOutput } from "./wrapper-output-layout.js"
import { usecaseCamerasReport } from "./wrapper-output-cameras.js"

export { usecaseNoClipsRenderedMessage, usecaseNoResultMessage, usecaseWrapperKeepsPartial } from "./wrapper-output-lists.js"

export type { UseCaseCameraSpeaker, UseCaseCamerasReport, UseCaseClipRow, UseCaseFormatRow, UseCaseWrapperOutput } from "./wrapper-output-parts.js"

function episodeOutput(
  graph: StoredInlineGraph,
  map: EpisodeOutputMap,
  nodeStates: Readonly<Record<string, unknown>>,
  executionId: string,
): UseCaseWrapperOutput {
  const mediaNodeId = completedOutput(nodeStates, map.media.nodeId) ? map.media.nodeId : map.renderNodeId
  const media = completedOutput(nodeStates, mediaNodeId)
  const render = completedOutput(nodeStates, map.renderNodeId)
  const planId = usecasePlanNodeId(map)
  const planOut = planId !== null ? completedOutput(nodeStates, planId) : undefined
  const transcriptOut = completedOutput(nodeStates, map.transcript.nodeId)
  const renderData = graph.nodes.find((n) => n.id === map.renderNodeId)?.data ?? {}
  const quality = (render?.quality ?? renderData.quality) === "proxy" ? "proxy" : "final"
  const videoUrl = str(media?.videoUrl)
  const audioUrl = videoUrl ? undefined : str(media?.audioUrl)
  // The node that delivered the episode is this run's: its own length, else the length it keeps.
  const durationSec = videoUrl || audioUrl
    ? runForwardedVideoLengthSec(mediaNodeId, undefined, graph.nodes, graph.edges, (id) => completedOutput(nodeStates, id) as RunOutputLengths | undefined)
    : undefined
  const cameras = usecaseCamerasReport(graph, nodeStates)
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
    ...(cameras ? { cameras } : {}),
    _executionId: executionId,
    ...failedStepOf(graph, nodeStates),
  }
}

export function usecaseWrapperOutput(
  graph: StoredInlineGraph,
  nodeStates: Readonly<Record<string, unknown>>,
  executionId: string,
): UseCaseWrapperOutput {
  const map = graph.outputMap
  // `case undefined` + `case "episode"` is `usecaseResultKind(map) === "episode"`
  // spelled so the switch narrows the map: keep it in step with that function
  // (and with usecaseWrapperHasResult below, which reads it).
  switch (map.kind) {
    // A P1 snapshot names no kind: an episode.
    case undefined:
    case "episode":
      return episodeOutput(graph, map, nodeStates, executionId)
    case "layout":
      return layoutOutput(graph, map, nodeStates, executionId)
    default:
      return listOutput(graph, nodeStates, executionId)
  }
}

/** Whether a completed run delivered what its kind promises (the finaliser completes only such a run). */
export function usecaseWrapperHasResult(graph: StoredInlineGraph | null, output: UseCaseWrapperOutput): boolean {
  // An erased snapshot: read as P1 read every run, by its media.
  if (!graph) return !!(output.videoUrl || output.audioUrl)
  // The same kind usecaseWrapperOutput dispatches on (there spelled as a narrowing switch).
  switch (usecaseResultKind(graph.outputMap)) {
    case "episode":
      return !!(output.videoUrl || output.audioUrl)
    case "clips":
      return (output.clips?.length ?? 0) > 0
    case "formats":
      // A review-on run delivers the trailer's preview; a final run, its formats.
      return (output.formats?.length ?? 0) > 0 || (output.quality === "proxy" && !!output.videoUrl)
    case "chapters":
      return typeof output.text === "string" && output.text.length > 0
    case "layout":
      // The framed recording (a review-on run's is its proxy preview).
      return !!output.videoUrl
  }
}
