/**
 * Utilities for presentation mode — identifies input/output nodes from the DAG.
 */

import type { WorkflowNode, WorkflowEdge, SceneNodeType } from "@/types/nodes"

/** Node types that represent user-interactive inputs */
const INPUT_NODE_TYPES = new Set<SceneNodeType>([
  "text-prompt",
  "upload-image",
  "upload-video",
  "upload-audio",
  "tone",
  "style-guide",
  "provider",
  "scene-count",
  "duration",
  "aspect-ratio",
  "motion",
  "camera-motion",
  "reference-audio",
])

/** Node types that are triggers (excluded from presentation inputs) */
const TRIGGER_NODE_TYPES = new Set<SceneNodeType>([
  "webhook-trigger",
  "schedule-trigger",
])

/** Node types that don't produce visible output */
const NON_OUTPUT_TYPES = new Set<SceneNodeType>([
  "text-prompt",
  "list",
  "loop",
  "upload-image",
  "upload-video",
  "upload-audio",
  "reference-audio",
  "rss-feed",
  "youtube-video",
  "tone",
  "style-guide",
  "provider",
  "scene-count",
  "duration",
  "aspect-ratio",
  "motion",
  "camera-motion",
  "sticky-note",
  "sub-workflow-input",
  "sub-workflow-output",
  "webhook-trigger",
  "schedule-trigger",
  "combine-text",
  "split-text",
  "save-to-storage",
  "webhook-output",
])

export type OutputType = "image" | "video" | "audio" | "text" | "data"

/** Get nodes that represent user-interactive inputs (excludes triggers) */
export function getInputNodes(nodes: WorkflowNode[]): WorkflowNode[] {
  return nodes.filter(
    (n) => n.type && INPUT_NODE_TYPES.has(n.type) && !TRIGGER_NODE_TYPES.has(n.type),
  )
}

/** Get leaf nodes that produce visible output (no downstream edges to non-output nodes) */
export function getOutputNodes(
  nodes: WorkflowNode[],
  edges: WorkflowEdge[],
): WorkflowNode[] {
  // Find nodes that have outgoing edges
  const nodesWithOutgoing = new Set(edges.map((e) => e.source))

  return nodes.filter((n) => {
    if (!n.type) return false
    if (NON_OUTPUT_TYPES.has(n.type)) return false
    // Leaf node (no outgoing edges) OR produces media regardless
    return !nodesWithOutgoing.has(n.id) || isMediaProducingNode(n.type)
  })
}

function isMediaProducingNode(type: SceneNodeType): boolean {
  return [
    "generate-image", "edit-image", "image-to-image",
    "generate-script", "ai-writer",
    "image-to-video", "video-to-video", "text-to-video", "extend-video",
    "text-to-speech", "generate-music", "text-to-audio", "text-to-dialogue",
    "voice-changer", "dubbing", "voice-remix", "voice-design",
    "render-video", "video-composer", "after-effects", "lottie-overlay",
    "3d-title", "motion-graphics", "composite",
  ].includes(type)
}

/** Determine the output type of a node */
export function getOutputType(nodeType: SceneNodeType | undefined): OutputType {
  if (!nodeType) return "data"

  const imageTypes: SceneNodeType[] = [
    "generate-image", "edit-image", "image-to-image",
  ]
  const videoTypes: SceneNodeType[] = [
    "image-to-video", "video-to-video", "text-to-video", "extend-video",
    "render-video", "video-composer", "after-effects", "lottie-overlay",
    "3d-title", "motion-graphics", "composite",
    "combine-videos", "merge-video-audio", "resize-video", "trim-video",
    "speed-ramp", "loop-video", "fade-video", "transcode-video",
    "lip-sync", "motion-transfer", "video-upscale", "add-captions",
  ]
  const audioTypes: SceneNodeType[] = [
    "text-to-speech", "generate-music", "text-to-audio",
    "text-to-dialogue", "voice-changer", "dubbing", "voice-remix",
    "voice-design", "mix-audio", "adjust-volume", "extract-audio",
    "audio-isolation",
  ]
  const textTypes: SceneNodeType[] = [
    "generate-script", "ai-writer", "transcribe", "image-to-text",
    "qa-check",
  ]

  if (imageTypes.includes(nodeType)) return "image"
  if (videoTypes.includes(nodeType)) return "video"
  if (audioTypes.includes(nodeType)) return "audio"
  if (textTypes.includes(nodeType)) return "text"
  return "data"
}

/** Extract the result URL or text from a node's data */
export function getNodeResult(nodeData: Record<string, unknown>): {
  url?: string
  text?: string
  results?: Array<{ url?: string; text?: string }>
} {
  const generatedResults = nodeData.generatedResults as Array<Record<string, unknown>> | undefined

  if (generatedResults && generatedResults.length > 0) {
    const activeIndex = (nodeData.activeResultIndex as number) ?? 0
    const active = generatedResults[activeIndex] ?? generatedResults[0]
    const url = (active?.url ?? active?.imageUrl ?? active?.videoUrl ?? active?.audioUrl) as string | undefined
    const text = (active?.text ?? active?.script) as string | undefined

    return {
      url,
      text,
      results: generatedResults.map((r) => ({
        url: (r.url ?? r.imageUrl ?? r.videoUrl ?? r.audioUrl) as string | undefined,
        text: (r.text ?? r.script) as string | undefined,
      })),
    }
  }

  // Fallback to individual generated fields
  const url =
    (nodeData.generatedImageUrl ??
      nodeData.generatedVideoUrl ??
      nodeData.generatedAudioUrl) as string | undefined
  const text = (nodeData.generatedScript ?? nodeData.generatedText) as string | undefined

  return { url, text }
}

/** Get the label for a node, falling back to type */
export function getNodeLabel(node: WorkflowNode): string {
  return (node.data as Record<string, unknown>).label as string
    || node.type?.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
    || "Node"
}
