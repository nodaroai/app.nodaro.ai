// @registry-lookup reads the default data of the one node type it adds (Merge Video & Audio)
import type { SceneNodeType, WorkflowEdge, WorkflowNode } from "@/types/nodes"
import { NODE_DEF_MAP } from "@/types/nodes"

/**
 * Generate Video no longer has an "Audio" input (decided 2026-10-28). It laid a
 * soundtrack over the finished clip — what a Merge Video & Audio node does —
 * next to "Audio Refs", which the model uses while it generates; two audio
 * inputs read as one. A saved graph with a wire into it loads the way it ran:
 *
 *  - the wire becomes a Merge Video & Audio node after the video node, mixed as
 *    the server mixed it (the track at full volume over the clip, the clip's own
 *    sound kept at 30 % only when the node generated audio), and everything the
 *    video node fed now comes from the merge;
 *  - on LTX 2.3 Pro, where that wire drove the generation (audio-to-video), it
 *    moves to "Audio Refs", which carries it now;
 *  - on LTX 2.3 Fast, which never read it, the wire is dropped.
 *
 * Idempotent: a graph with no such wire comes back unchanged.
 */

const AUDIO_HANDLE = "audio"
const MERGE_TYPE = "merge-video-audio"
const MERGE_IN = "in"
const MERGE_OUT = "video-out"
const VIDEO_OUT = "video"
const MERGE_GAP_X = 120
const DEFAULT_NODE_WIDTH = 240

export interface GenerateVideoAudioMigration {
  readonly nodes: WorkflowNode[]
  readonly edges: WorkflowEdge[]
}

export function migrateGenerateVideoAudioInput(
  nodes: ReadonlyArray<WorkflowNode>,
  edges: ReadonlyArray<WorkflowEdge>,
): GenerateVideoAudioMigration {
  const byId = new Map(nodes.map((n) => [n.id, n]))
  const audioWires = edges.filter((e) => e.targetHandle === AUDIO_HANDLE && byId.get(e.target)?.type === "generate-video")
  if (audioWires.length === 0) return { nodes: [...nodes], edges: [...edges] }

  const addedNodes: WorkflowNode[] = []
  let nextEdges = edges.filter((e) => !audioWires.includes(e))
  const wiresByVideo = new Map<string, WorkflowEdge[]>()
  for (const e of audioWires) wiresByVideo.set(e.target, [...(wiresByVideo.get(e.target) ?? []), e])

  for (const [videoId, wires] of wiresByVideo) {
    const video = byId.get(videoId)!
    const data = (video.data ?? {}) as Record<string, unknown>
    const provider = typeof data.provider === "string" ? data.provider : undefined

    if (provider === "ltx-2.3-pro") {
      nextEdges = [...nextEdges, ...wires.map((e) => ({ ...e, id: `${e.id}-refs`, targetHandle: "audioReferences" }))]
      continue
    }
    if (provider === "ltx-2.3-fast") continue

    const mergeId = `${videoId}-audio-merge`
    if (byId.has(mergeId)) continue
    const width = (video as { width?: number; measured?: { width?: number } }).measured?.width ?? (video as { width?: number }).width ?? DEFAULT_NODE_WIDTH
    const defaults = (NODE_DEF_MAP.get(MERGE_TYPE)?.defaultData ?? {}) as Record<string, unknown>
    addedNodes.push({
      id: mergeId,
      type: MERGE_TYPE as SceneNodeType,
      position: { x: video.position.x + width + MERGE_GAP_X, y: video.position.y },
      ...(video.parentId ? { parentId: video.parentId } : {}),
      data: {
        ...defaults,
        audioType: "voiceover",
        voiceoverVolume: 100,
        keepOriginalAudio: data.generateAudio === true,
        originalAudioVolume: 30,
        originalAudioRole: "background",
      },
    } as unknown as WorkflowNode)

    // What the video node fed now comes from the merge.
    nextEdges = nextEdges.map((e) =>
      e.source === videoId && (e.sourceHandle ?? VIDEO_OUT) === VIDEO_OUT ? { ...e, source: mergeId, sourceHandle: MERGE_OUT } : e,
    )
    const style = wires[0]!
    nextEdges = [
      ...nextEdges,
      { ...style, id: `${videoId}-to-${mergeId}`, source: videoId, sourceHandle: VIDEO_OUT, target: mergeId, targetHandle: MERGE_IN },
      ...wires.map((e) => ({ ...e, id: `${e.id}-merge`, target: mergeId, targetHandle: MERGE_IN })),
    ]
  }

  return { nodes: [...nodes, ...addedNodes], edges: nextEdges }
}
