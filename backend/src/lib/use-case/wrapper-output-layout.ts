/**
 * What a layout run's wrapper job reports (Speaker Layout, decided
 * 2026-10-17): the whole recording framed by speaker — no plan, no cut. Read
 * from the inner run's node states through the graph's outputMap, as an
 * episode is (wrapper-output.ts), all from its one render:
 * - videoUrl: the framed recording (a review-on run's is its proxy preview);
 * - json: the edit Speaker View drew; transcript: the transcript it renamed
 *   (the render's own `transcript`, the speakers as the edit names them);
 * - the take's quality and its render's `renderBasis` (there is no plan, so no
 *   `planBasis`), and the settings the run was built from (`useCaseSettings`):
 *   a Render final renders with THOSE;
 * - its length (`durationSec`) when the run knows it, as an episode's — what a
 *   Trim, Loop or Combine Videos after the node is charged by;
 * - a run on several recordings or a Master audio: its cameras report;
 * - a failed run keeps what completed and names the failed step in the
 *   user's words. Pure.
 */
import { runForwardedVideoLengthSec, type LayoutOutputMap, type RunOutputLengths, type StoredInlineGraph } from "@nodaro/render-rules"
import { completedOutput, failedStepOf, isRecord, str, type UseCaseWrapperOutput } from "./wrapper-output-parts.js"
import { usecaseCamerasReport } from "./wrapper-output-cameras.js"

export function layoutOutput(
  graph: StoredInlineGraph,
  map: LayoutOutputMap,
  nodeStates: Readonly<Record<string, unknown>>,
  executionId: string,
): UseCaseWrapperOutput {
  const render = completedOutput(nodeStates, map.renderNodeId)
  const renderData = graph.nodes.find((n) => n.id === map.renderNodeId)?.data ?? {}
  const videoUrl = str(render?.videoUrl)
  const durationSec = videoUrl
    ? runForwardedVideoLengthSec(map.renderNodeId, undefined, graph.nodes, graph.edges, (id) => completedOutput(nodeStates, id) as RunOutputLengths | undefined)
    : undefined
  const cameras = usecaseCamerasReport(graph, nodeStates)
  return {
    ...(videoUrl ? { videoUrl } : {}),
    ...(render?.json !== undefined ? { json: render.json } : {}),
    ...(render?.transcript !== undefined ? { transcript: render.transcript } : {}),
    quality: (render?.quality ?? renderData.quality) === "proxy" ? "proxy" : "final",
    ...(str(render?.renderBasis) ? { renderBasis: str(render?.renderBasis) } : {}),
    ...(isRecord(graph.settings) ? { useCaseSettings: graph.settings } : {}),
    ...(durationSec !== undefined ? { durationSec } : {}),
    ...(cameras ? { cameras } : {}),
    _executionId: executionId,
    ...failedStepOf(graph, nodeStates),
  }
}
