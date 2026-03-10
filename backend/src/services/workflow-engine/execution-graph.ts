/**
 * Execution graph utilities — ported from frontend, no React/Zustand dependencies.
 * Pure functions operating on SimpleNode/SimpleEdge arrays.
 */

import type { SimpleNode, SimpleEdge } from "./types.js"

/**
 * Topological sort via Kahn's algorithm.
 * Returns array of levels where nodes in the same level can execute in parallel.
 *
 * When `preResolvedNodeIds` is provided, edges FROM those nodes are excluded
 * from both in-degree computation and the children map.  This allows nodes
 * whose only dependencies are pre-resolved (e.g. source nodes whose outputs
 * are already available) to be promoted to earlier levels, enabling more
 * parallelism.
 */
export function buildExecutionLevels(
  nodes: SimpleNode[],
  edges: SimpleEdge[],
  preResolvedNodeIds?: Set<string>,
): SimpleNode[][] {
  const inDegree = new Map<string, number>()
  const children = new Map<string, string[]>()
  const nodeMap = new Map<string, SimpleNode>()

  for (const node of nodes) {
    nodeMap.set(node.id, node)
    inDegree.set(node.id, 0)
    children.set(node.id, [])
  }

  for (const edge of edges) {
    if (!nodeMap.has(edge.source) || !nodeMap.has(edge.target)) continue
    // Skip edges from pre-resolved nodes — their outputs are already available,
    // so they shouldn't create execution-level dependencies.
    if (preResolvedNodeIds?.has(edge.source)) continue
    inDegree.set(edge.target, (inDegree.get(edge.target) ?? 0) + 1)
    children.get(edge.source)?.push(edge.target)
  }

  const levels: SimpleNode[][] = []
  let currentLevel = nodes.filter((n) => (inDegree.get(n.id) ?? 0) === 0)

  while (currentLevel.length > 0) {
    levels.push(currentLevel)
    const nextLevel: SimpleNode[] = []
    const seen = new Set<string>()

    for (const node of currentLevel) {
      for (const childId of children.get(node.id) ?? []) {
        const newDeg = (inDegree.get(childId) ?? 1) - 1
        inDegree.set(childId, newDeg)
        if (newDeg === 0 && !seen.has(childId)) {
          seen.add(childId)
          const childNode = nodeMap.get(childId)
          if (childNode) nextLevel.push(childNode)
        }
      }
    }

    currentLevel = nextLevel
  }

  return levels
}

/**
 * Compute skipped (frozen) node IDs.
 * "Skip" means "freeze" — the node keeps its existing output but does not
 * re-execute.  Downstream nodes still run using the frozen node's saved output.
 * No propagation: only directly skipped nodes are returned.
 */
export function getEffectivelySkippedIds(
  nodes: SimpleNode[],
  _edges: SimpleEdge[],
): Set<string> {
  return new Set(
    nodes.filter((n) => !!n.data.skipped).map((n) => n.id),
  )
}

// ---------------------------------------------------------------------------
// Source node detection
// ---------------------------------------------------------------------------

/** Node types that are source nodes — they produce output from their data, not from execution */
const SOURCE_NODE_TYPES = new Set([
  "text-prompt",
  "upload-image",
  "upload-video",
  "upload-audio",
  "youtube-video",
  "reference-audio",
  "list",
  "loop",
  "webhook-trigger",
  "schedule-trigger",
  "sub-workflow-input",
])

export function isSourceNode(nodeType: string): boolean {
  return SOURCE_NODE_TYPES.has(nodeType)
}

/** Node types that should be skipped during backend execution */
const SKIP_NODE_TYPES = new Set([
  "manual-edit",
  "sub-workflow-output",
])

export function isSkipNode(nodeType: string): boolean {
  return SKIP_NODE_TYPES.has(nodeType)
}

/** Node types representing user-uploaded private content */
const UPLOAD_NODE_TYPES = new Set([
  "upload-image",
  "upload-video",
  "upload-audio",
])

/**
 * Compute all node IDs that are downstream descendants of upload-* nodes.
 * These nodes use private uploaded content as input and should be force_private.
 * Uses BFS forward from upload nodes through edges.
 */
export function getUploadDescendantIds(
  nodes: SimpleNode[],
  edges: SimpleEdge[],
): Set<string> {
  const uploadNodeIds = new Set(
    nodes.filter((n) => UPLOAD_NODE_TYPES.has(n.type)).map((n) => n.id),
  )
  if (uploadNodeIds.size === 0) return new Set()

  // Build adjacency list (source → targets)
  const children = new Map<string, string[]>()
  for (const edge of edges) {
    const list = children.get(edge.source) ?? []
    list.push(edge.target)
    children.set(edge.source, list)
  }

  // BFS forward from upload nodes
  const descendants = new Set<string>()
  const queue = [...uploadNodeIds]
  while (queue.length > 0) {
    const nodeId = queue.shift()!
    for (const childId of children.get(nodeId) ?? []) {
      if (!descendants.has(childId)) {
        descendants.add(childId)
        queue.push(childId)
      }
    }
  }

  return descendants
}

// ---------------------------------------------------------------------------
// Media type sets — used for routing inputs
// ---------------------------------------------------------------------------

export const IMAGE_SOURCE_TYPES = new Set([
  "generate-image",
  "upload-image",
  "edit-image",
  "image-to-image",
  "character",
  "face",
  "object",
  "location",
  "scene",
])

export const VIDEO_SOURCE_TYPES = new Set([
  "image-to-video",
  "video-to-video",
  "text-to-video",
  "upload-video",
  "youtube-video",
  "combine-videos",
  "lip-sync",
  "motion-transfer",
  "video-upscale",
  "extend-video",
  "suno-music-video",
  "merge-video-audio",
  "add-captions",
  "resize-video",
  "social-media-format",
  "trim-video",
  "render-video",
  "speed-ramp",
  "loop-video",
  "fade-video",
  "transcode-video",
])

export const AUDIO_SOURCE_TYPES = new Set([
  "text-to-speech",
  "text-to-audio",
  "generate-music",
  "upload-audio",
  "suno-generate",
  "suno-cover",
  "suno-extend",
  "suno-separate",
  "suno-mashup",
  "suno-replace-section",
  "suno-add-instrumental",
  "suno-add-vocals",
  "suno-convert-wav",
  "suno-upload-extend",
  "extract-audio",
  "mix-audio",
  "adjust-volume",
  "reference-audio",
  "audio-isolation",
  "text-to-dialogue",
  "voice-changer",
  "dubbing",
  "voice-remix",
  "voice-design",
])

export const TEXT_SOURCE_TYPES = new Set([
  "text-prompt",
  "transcribe",
  "suno-lyrics",
  "suno-style-boost",
  "image-to-text",
  "ai-writer",
  "combine-text",
  "split-text",
  "forced-alignment",
  "generate-script",
  "list",
  "loop",
])
