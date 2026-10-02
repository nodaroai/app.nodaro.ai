/**
 * How long a video each node can read — so the Video URL node's part chooser
 * and the run's "choose a part" message can SAY how long a part may be,
 * instead of leaving the person to guess.
 *
 * Keyed by the CONSUMER node type (a node a Video URL feeds). The numbers are
 * the consumers' own published limits, never restated: Video Analysis and AI
 * Audit refuse a video past VIDEO_ANALYSIS_MAX_DURATION_SEC and price by the
 * VIDEO_ANALYSIS_DURATION_BUCKETS ladder, whose first bucket costs the least.
 * A consumer with a length limit of its own joins this table; one without is
 * simply absent (any length).
 */
import { VIDEO_ANALYSIS_DURATION_BUCKETS, VIDEO_ANALYSIS_MAX_DURATION_SEC } from "@nodaro/shared"
import type { WorkflowEdge, WorkflowNode } from "@/types/nodes"

export interface VideoLengthLimit {
  /** The longest video the node reads, in seconds. */
  readonly maxSec: number
  /** Up to this length a run costs the least, in seconds. */
  readonly cheapestSec: number
}

export const VIDEO_LENGTH_LIMITS: Readonly<Record<string, VideoLengthLimit>> = {
  "video-analysis": { maxSec: VIDEO_ANALYSIS_MAX_DURATION_SEC, cheapestSec: VIDEO_ANALYSIS_DURATION_BUCKETS[0] },
  "video-audit": { maxSec: VIDEO_ANALYSIS_MAX_DURATION_SEC, cheapestSec: VIDEO_ANALYSIS_DURATION_BUCKETS[0] },
}

export interface VideoLinkLengthLimit extends VideoLengthLimit {
  /** The node type that sets the limit — its name goes in the message. */
  readonly consumerType: string
}

/**
 * The strictest length limit among the nodes a Video URL node feeds, or null
 * when none of them limits length. Skipped nodes are not part of a run and do
 * not count.
 */
export function videoLinkLengthLimit(
  nodeId: string,
  nodes: readonly WorkflowNode[],
  edges: readonly WorkflowEdge[],
): VideoLinkLengthLimit | null {
  let strictest: VideoLinkLengthLimit | null = null
  for (const edge of edges) {
    if (edge.source !== nodeId) continue
    const consumer = nodes.find((n) => n.id === edge.target)
    if (!consumer?.type) continue
    if ((consumer.data as { skipped?: unknown } | undefined)?.skipped === true) continue
    const limit = VIDEO_LENGTH_LIMITS[consumer.type]
    if (!limit) continue
    if (!strictest || limit.maxSec < strictest.maxSec) strictest = { ...limit, consumerType: consumer.type }
  }
  return strictest
}
