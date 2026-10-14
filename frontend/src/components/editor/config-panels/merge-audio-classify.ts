import { AUDIO_PRODUCER_TYPES, VIDEO_PRODUCER_TYPES } from "@nodaro/shared"
import { bypassTeleports, drawnSourceId } from "@nodaro/render-rules"
import type { WorkflowEdge, WorkflowNode } from "@/types/nodes"

export type MergeMediaKind = "video" | "audio" | null

/**
 * Classify an incoming source for the merge-video-audio config panel as the
 * video to merge into ("video"), a mixable audio track ("audio"), or neither
 * (null — not a media producer, must never render as a track).
 *
 * Consumes the shared `AUDIO_PRODUCER_TYPES` / `VIDEO_PRODUCER_TYPES` single
 * source of truth (same sets that drive handle acceptance + the executor) so
 * this panel can never again drift behind them — the drift that silently
 * dropped voice-changer (and dubbing / voice-remix / voice-design / …) from
 * the Audio Tracks list while their audio still merged at default volume.
 *
 * `effectiveType` is the source node's type, except sub-workflow ports which
 * the caller pre-resolves to "__audio__" / "__video__" from the port mediaType.
 * `sourceHandle` is the id of the handle the wire leaves — dual-output nodes
 * (voice-changer, split-media) expose distinct `audio` / `video` source
 * handles, so the handle names the lane regardless of the node's default.
 */
export function classifyMergeSource(
  effectiveType: string,
  sourceHandle?: string,
): MergeMediaKind {
  // Dual-output media nodes name their lane on the source handle.
  if (sourceHandle === "video") return "video"
  if (sourceHandle === "audio") return "audio"

  // Sub-workflow output ports, pre-resolved by the caller.
  if (effectiveType === "__video__") return "video"
  if (effectiveType === "__audio__") return "audio"

  // Static classification via the shared single source of truth.
  if (VIDEO_PRODUCER_TYPES.has(effectiveType)) return "video"
  if (AUDIO_PRODUCER_TYPES.has(effectiveType)) return "audio"

  // split-media emits chunk lanes on `col_<id>` handles (not audio/video);
  // default its chunk stream to an audio track to preserve prior behavior.
  if (effectiveType === "split-media") return "audio"

  return null
}

/**
 * A source the merge panel lists: the node a wire CARRIES (its type and data)
 * under the id the wire was DRAWN from — a Teleport Receive's id for a wire
 * leaving one. `trackSettings` are keyed by `id`; the run maps a Receive's key
 * to the origin (@nodaro/render-rules carriedNodeSettings).
 */
export interface MergeSource {
  readonly id: string
  readonly type: string
  readonly data: Record<string, unknown>
}

export interface MergeSources {
  readonly videoSource: MergeSource | null
  readonly audioSources: readonly MergeSource[]
}

/**
 * The video to merge into and the audio tracks wired into a Merge Video & Audio
 * node, read from the graph as it carries: a Teleport Receive passes on exactly
 * what entered its Send (@nodaro/render-rules teleport-bypass.ts), so it is
 * classified by the origin's type and pip, as both engines run it. The first
 * video is the base; any further video has its audio extracted. Each origin is
 * listed once (first wire wins). Takes the store's raw edges.
 */
export function mergeSourcesOf(
  consumerId: string,
  edges: ReadonlyArray<WorkflowEdge>,
  nodes: ReadonlyArray<WorkflowNode>,
): MergeSources {
  let videoSource: MergeSource | null = null
  const audioSources: MergeSource[] = []
  const seen = new Set<string>()

  for (const edge of bypassTeleports(nodes, edges)) {
    if (edge.target !== consumerId) continue
    const src = nodes.find((n) => n.id === edge.source)
    if (!src || seen.has(src.id)) continue
    const handle = edge.sourceHandle ?? undefined
    const data = src.data as Record<string, unknown>

    // Resolve sub-workflow output port media type from the edge's sourceHandle
    let effectiveType = src.type as string
    if (src.type === "sub-workflow" || src.type === "sub-workflow-input") {
      const snapshot = data.routeSnapshot as { outputPorts?: Array<{ id: string; mediaType: string }> } | undefined
      const ports = (src.type === "sub-workflow-input")
        ? (data.ports as Array<{ id: string; mediaType: string }> | undefined)
        : snapshot?.outputPorts
      if (handle && ports) {
        const portId = handle.replace(/^out_/, "")
        const port = ports.find((p) => p.id === portId)
        if (port?.mediaType === "audio") effectiveType = "__audio__"
        else if (port?.mediaType === "video") effectiveType = "__video__"
      }
    }

    const kind = classifyMergeSource(effectiveType, handle)
    if (kind === null) continue
    seen.add(src.id)
    const listed: MergeSource = { id: drawnSourceId(edge), type: src.type as string, data }
    if (kind === "video" && !videoSource) videoSource = listed
    else audioSources.push(listed)
  }
  return { videoSource, audioSources }
}
