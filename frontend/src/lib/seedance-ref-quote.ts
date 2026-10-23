/**
 * Seedance 2 reference-video quotes — the request the server prices exactly.
 *
 * A Seedance 2 run with a reference video is billed `unit × (input + output)`
 * seconds, so its price follows the reference clips' real lengths, which only
 * the server can measure (`POST /v1/credits/seedance-ref-estimate` probes them
 * and prices them as the reservation does). This module says, for a node, WHAT
 * that request is: the provider, the levers the run sends, and the reference
 * clips the run will send — read through the run's own input resolver
 * (`resolveNodeInputs`), so the quote and the run name the same clips.
 *
 * Two nodes make this call: Generate Video (and the legacy Image/Text to Video
 * nodes) with a clip wired into a reference-video handle, and Video to Video's
 * Seedance edit lane (its source clip IS reference video 1).
 *
 * The request is also a string — its quote key, `seedance-ref-quote:<json>` —
 * so the run estimate reads and prefetches it through the same price cache as
 * every model id (`hooks/use-model-credit-cost.ts` routes the prefix to the
 * quote endpoint). A clip not produced yet (no URL, or its upstream re-runs in
 * this run) is sent as `unknownReferenceVideos`: the server quotes it at the
 * worst case, never below what the run can reserve.
 */
import type { WorkflowEdge, WorkflowNode } from "@/types/nodes"
import type { SeedanceRefEstimateRequest } from "@/lib/api"
import {
  applyDefaultVideoSelection,
  billsReferenceVideoSeconds,
  isSeedanceVideoEditProvider,
} from "@nodaro/shared/models"
import {
  referenceModalityForHandle,
} from "@nodaro/shared/workflow"
import {
  VIDEO_DURATION_AUTO,
} from "@nodaro/shared/model-catalog"
import {
  withWiredSettings,
} from "@nodaro/shared/nodes"
import { bypassTeleports } from "@nodaro/render-rules"
import { resolveNodeInputs } from "@/components/editor/workflow-editor/node-input-resolver"
import { seedanceRefQuoteKey } from "@/lib/seedance-ref-quote-key"

export { SEEDANCE_REF_QUOTE_PREFIX, seedanceRefQuoteKey, isSeedanceRefQuoteKey, parseSeedanceRefQuoteKey } from "@/lib/seedance-ref-quote-key"

const VIDEO_GENERATION_TYPES = new Set(["generate-video", "image-to-video", "text-to-video"])

const NO_RERUNS: ReadonlySet<string> = new Set()

/**
 * The quote request for `storedNode`, or undefined when its price does not
 * follow reference clips (not a Seedance 2 model, no reference video wired).
 * `rerunIds`: the nodes a run re-executes — a clip whose source re-runs is not
 * the clip the run will send, so it counts as unknown.
 */
export function seedanceRefQuoteRequest(
  storedNode: WorkflowNode,
  nodes: ReadonlyArray<WorkflowNode>,
  rawEdges: ReadonlyArray<WorkflowEdge>,
  rerunIds: ReadonlySet<string> = NO_RERUNS,
): SeedanceRefEstimateRequest | undefined {
  const type = storedNode.type ?? ""
  const isGeneration = VIDEO_GENERATION_TYPES.has(type)
  if (!isGeneration && type !== "video-to-video") return undefined
  const node = withWiredSettings(storedNode, nodes as WorkflowNode[], rawEdges as WorkflowEdge[]) as WorkflowNode
  const data = node.data as Record<string, unknown>
  const edges = bypassTeleports(nodes as WorkflowNode[], rawEdges as WorkflowEdge[]) as WorkflowEdge[]

  // The clip wires the run reads: a reference-video handle on a generation
  // node; the source `video` handle on Video to Video.
  const clipEdges = edges.filter((e) => e.target === node.id && (
    isGeneration ? referenceModalityForHandle(e.targetHandle) === "video" : e.targetHandle === "video"
  ))
  if (clipEdges.length === 0) return undefined

  let provider: string
  let resolution: string | undefined
  let duration: number | string | undefined
  if (isGeneration) {
    const sel = applyDefaultVideoSelection({ provider: data.provider as string | undefined, duration: data.duration as number | string | undefined })
    provider = sel.provider
    resolution = data.resolution as string | undefined
    duration = sel.duration
  } else {
    provider = (data.provider as string | undefined) ?? ""
    if (!isSeedanceVideoEditProvider(provider)) return undefined
    resolution = data.v2vResolution as string | undefined
    duration = VIDEO_DURATION_AUTO
  }
  if (!billsReferenceVideoSeconds(provider)) return undefined

  // Resolve only the wires whose clip is already what the run will send.
  const stale = new Set(clipEdges.filter((e) => rerunIds.has(e.source)).map((e) => e.id))
  const readable = edges.filter((e) => !stale.has(e.id))
  const inputs = resolveNodeInputs(node, nodes as WorkflowNode[], readable)
  const urls = isGeneration
    ? (inputs.referenceVideoUrls ?? []).filter((u): u is string => typeof u === "string" && u.length > 0)
    : inputs.videoUrl ? [inputs.videoUrl] : []
  const unknown = Math.max(0, clipEdges.length - urls.length)

  return {
    provider,
    ...(resolution !== undefined ? { resolution } : {}),
    ...(duration !== undefined ? { duration } : {}),
    ...(data.draft === true ? { draft: true } : {}),
    referenceVideoUrls: urls,
    ...(unknown > 0 ? { unknownReferenceVideos: unknown } : {}),
  }
}

/** The node's quote key, or undefined when its price does not follow reference clips. */
export function seedanceRefQuoteKeyFor(
  node: WorkflowNode,
  nodes: ReadonlyArray<WorkflowNode>,
  edges: ReadonlyArray<WorkflowEdge>,
  rerunIds: ReadonlySet<string> = NO_RERUNS,
): string | undefined {
  const request = seedanceRefQuoteRequest(node, nodes, edges, rerunIds)
  return request ? seedanceRefQuoteKey(request) : undefined
}
