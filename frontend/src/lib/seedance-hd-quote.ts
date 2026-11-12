/**
 * The price id of a Seedance 2.5 HD finalize (Video Upscale, provider
 * `seedance-2-5-hd`) in a run estimate (decided 2026-11-12), as the server's
 * workflow estimate quotes it. Which node is the draft, and whether the run
 * makes it, is the shared rule (`seedanceFinalizeDraftQuote`,
 * @nodaro/render-rules) the server reads too:
 *
 * - the run MAKES the draft: the finalize at the length the draft's run
 *   reserves for — the most the finalize bills for output, so a true ceiling:
 *   - a draft with no reference video: the finalize row for its priced
 *     length, `seedance-2-5-hd:{N}s` — a plain id, priced like any other;
 *   - a draft with reference video(s): a quote key (`seedance-hd-quote-key.ts`)
 *     naming the draft's request — exactly the request the draft's own price
 *     is asked with (`seedanceRefQuoteRequest`, a clip not produced yet sent
 *     as unknown) — which the price cache sends to
 *     `POST /v1/credits/seedance-hd-estimate` as `plannedDraft`;
 * - the draft EXISTS (the run only finalizes it): a key naming its task id,
 *   priced exactly by the same endpoint — the figure the node's pill shows.
 *
 * Undefined for any other node, and for a finalize with no draft wired: it is
 * priced as before.
 */
import type { WorkflowEdge, WorkflowNode } from "@/types/nodes"
import type { SeedancePlannedDraftRequest } from "@/lib/api"
import { seedanceFinalizeDraftQuote } from "@nodaro/render-rules"
import { VIDEO_DURATION_AUTO } from "@nodaro/shared/model-catalog"
import { withWiredSettings } from "@nodaro/shared/nodes"
import { seedanceRefQuoteRequest } from "@/lib/seedance-ref-quote"
import { seedanceHdDraftKey, seedanceHdQuoteKey } from "@/lib/seedance-hd-quote-key"

const NO_RERUNS: ReadonlySet<string> = new Set()

export function seedanceHdQuoteIdFor(
  node: WorkflowNode,
  nodes: ReadonlyArray<WorkflowNode>,
  edges: ReadonlyArray<WorkflowEdge>,
  rerunIds: ReadonlySet<string> = NO_RERUNS,
): string | undefined {
  const quote = seedanceFinalizeDraftQuote(node, nodes, edges, rerunIds)
  if (!quote) return undefined
  if (quote.kind === "existing") return seedanceHdDraftKey(quote.taskId)
  if (!quote.hasRefVideo) return quote.creditId
  const draft = quote.draft as WorkflowNode
  const request = seedanceRefQuoteRequest(draft, nodes, edges, rerunIds) ?? unwiredVideoToVideoDraft(draft, nodes, edges)
  if (!request) return undefined
  return seedanceHdQuoteKey({
    provider: request.provider,
    resolution: request.resolution,
    duration: request.duration,
    draft: request.draft,
    referenceTaskType: request.referenceTaskType,
    referenceVideoUrls: request.referenceVideoUrls,
    unknownReferenceVideos: request.unknownReferenceVideos,
  })
}

/**
 * A Video to Video draft whose source clip is not wired: its run still sends
 * one — the node's own `videoUrl` — so it is counted as the run sends it, that
 * URL, else one clip not known yet (the server's estimate counts it the same).
 */
function unwiredVideoToVideoDraft(
  draft: WorkflowNode,
  nodes: ReadonlyArray<WorkflowNode>,
  edges: ReadonlyArray<WorkflowEdge>,
): SeedancePlannedDraftRequest | undefined {
  if (draft.type !== "video-to-video") return undefined
  const data = withWiredSettings(draft, nodes as WorkflowNode[], edges as WorkflowEdge[]).data as Record<string, unknown>
  if (typeof data.provider !== "string") return undefined
  const url = typeof data.videoUrl === "string" && data.videoUrl !== "" ? data.videoUrl : undefined
  return {
    provider: data.provider,
    ...(typeof data.v2vResolution === "string" ? { resolution: data.v2vResolution } : {}),
    duration: VIDEO_DURATION_AUTO,
    draft: true,
    referenceVideoUrls: url ? [url] : [],
    ...(url ? {} : { unknownReferenceVideos: 1 }),
  }
}
