/**
 * BASE credits of a video-utility node (Trim Video, Loop Video, Combine
 * Videos, Assemble Narrated Video) from the graph: its own settings plus the
 * upstream lengths and the clips its wires bring. The node's price pill shows
 * it, and the workflow estimate divides it into pricing units
 * (`workflow-editor/types.ts :: getPricingUnits`), so the two read one number.
 * The estimators are the ones the routes and the workflow run charge with
 * (`@nodaro/shared`).
 */
import {
  assembleNarratedVideoCredits,
  estimateCombineVideosCredits,
  estimateLoopVideoCredits,
  estimateTrimVideoCredits,
  VIDEO_UTIL_PRICING,
  type CombineVideosEstimatorInput,
  type LoopVideoEstimatorInput,
  type TrimVideoEstimatorInput,
} from "@nodaro/shared"
import { extractVideoDurationFromNode } from "@nodaro/shared"
import { runWireLengthSec, videoSfxClipSec } from "@nodaro/render-rules"
import { readPlan } from "@/lib/apply-edl-estimate"
import { upstreamVideoDurationSec } from "@/lib/upstream-video-duration"
import { getCombineUpstreamDurations, getUpstreamDuration, type WireDurationReader } from "@/lib/upstream-duration"
import type { WorkflowEdge, WorkflowNode } from "@/types/nodes"

/**
 * The seconds the video on a wire runs, as an ESTIMATE reads it
 * (`runWireLengthSec`, the rule the server's run estimate and the listing
 * read): a render's output at the render's estimated minutes, a chain of
 * Trim / Loop / Combine Videos / Video SFX at the length each passes on, and
 * any other source at what its own data holds (an upload's length, a
 * generation's duration). Unknown stays `undefined`: the estimators' fallback
 * length stands in.
 *
 * @param rerunIds the nodes about to EXECUTE (empty for a single node's own price).
 */
function wireDurationReader(
  nodes: ReadonlyArray<WorkflowNode>,
  edges: ReadonlyArray<WorkflowEdge>,
  rerunIds: ReadonlySet<string>,
): WireDurationReader {
  return (sourceId) =>
    runWireLengthSec(sourceId, nodes, edges, rerunIds, {
      planOutputOf: readPlan,
      otherSec: (origin) => extractVideoDurationFromNode(origin.data as Record<string, unknown>),
    })
}

/**
 * The clip length a RUN estimate prices a Video SFX at, in seconds: its
 * `video` wire's length where a run estimate follows it (a render's output, a
 * chain of Trim / Loop / Combine Videos / Video SFX), at most the 300 seconds
 * a run accepts, as the listing and the server's run estimate read it
 * (`videoSfxClipSec`, decided 2026-10-07). `undefined` when no wire's length
 * is known: the caller falls back to the length the upstream node reports, then
 * to the unmeasured-clip row.
 *
 * @param rerunIds the nodes about to EXECUTE (empty for a single node's own price).
 */
export function estimateVideoSfxClipSec(
  node: Pick<WorkflowNode, "id">,
  nodes: ReadonlyArray<WorkflowNode>,
  edges: ReadonlyArray<WorkflowEdge>,
  rerunIds: ReadonlySet<string> = new Set(),
): number | undefined {
  const inputs = edges.filter((e) => e.target === node.id)
  const lengthOf = wireDurationReader(nodes, edges, rerunIds)
  return videoSfxClipSec(inputs, inputs.map((e) => lengthOf(e.source)))
}

/**
 * The clip length, in seconds, a Video SFX is QUOTED at, or `null` for an
 * unmeasured clip (the 8-second row): the length the graph gives the video
 * ({@link estimateVideoSfxClipSec}), else what the upstream node itself
 * reports. The one reading behind the node's own Run button, its toolbar, the
 * confirm dialog and the workflow badge, so they quote one row.
 */
export function videoSfxQuotedSec(
  node: Pick<WorkflowNode, "id">,
  nodes: ReadonlyArray<WorkflowNode>,
  edges: ReadonlyArray<WorkflowEdge>,
  rerunIds: ReadonlySet<string> = new Set(),
): number | null {
  return estimateVideoSfxClipSec(node, nodes, edges, rerunIds) ?? upstreamVideoDurationSec(node.id, "video", nodes, edges)
}

export function estimateVideoUtilityBaseCredits(
  node: WorkflowNode,
  nodes: ReadonlyArray<WorkflowNode>,
  edges: ReadonlyArray<WorkflowEdge>,
  rerunIds: ReadonlySet<string> = new Set(),
): number | undefined {
  const data = node.data as Record<string, unknown>
  const durationOf = wireDurationReader(nodes, edges, rerunIds)
  switch (node.type) {
    case "loop-video":
      return estimateLoopVideoCredits(data as LoopVideoEstimatorInput, getUpstreamDuration(node.id, nodes, edges, durationOf))
    case "trim-video":
      return estimateTrimVideoCredits(data as TrimVideoEstimatorInput, getUpstreamDuration(node.id, nodes, edges, durationOf))
    case "combine-videos":
      return estimateCombineVideosCredits(data as CombineVideosEstimatorInput, getCombineUpstreamDurations(node, nodes, edges, durationOf))
    case "assemble-narrated-video": {
      // Block count = edges wired into the "video" handle (the `blocks` array
      // driver — see execute-node.ts). No inputs wired yet still prices the
      // 1-block floor (never shows the unreachable N=0 value).
      const wired = edges.filter((e) => e.target === node.id && e.targetHandle === "video").length
      return assembleNarratedVideoCredits(Math.max(1, wired))
    }
    default:
      return undefined
  }
}

/** Pricing units of a video-utility node: its base credits over one unit (its own one-unit price row). */
export function videoUtilityPricingUnits(
  node: WorkflowNode,
  nodes: ReadonlyArray<WorkflowNode>,
  edges: ReadonlyArray<WorkflowEdge>,
  rerunIds: ReadonlySet<string> = new Set(),
): number {
  const base = estimateVideoUtilityBaseCredits(node, nodes, edges, rerunIds)
  return base === undefined ? 1 : base / VIDEO_UTIL_PRICING.CREDIT_UNIT
}
