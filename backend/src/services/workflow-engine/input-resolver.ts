/**
 * Input resolver — wires upstream node outputs into downstream node inputs.
 * Backend equivalent of frontend resolveNodeInputs().
 * Stateless function with no React/Zustand dependencies.
 */

import type {
  SimpleNode,
  SimpleEdge,
  NodeExecutionState,
  ResolvedInputs,
} from "./types.js"
import { extractSourceNodeOutput, getPrimaryOutput } from "./output-extractor.js"
import { isSourceNode } from "./execution-graph.js"

/**
 * Resolve all inputs for a target node from its upstream connected nodes.
 */
export function resolveNodeInputs(
  targetNode: SimpleNode,
  edges: SimpleEdge[],
  nodeStates: Record<string, NodeExecutionState>,
  allNodes: SimpleNode[],
  triggerData?: Record<string, unknown>,
): ResolvedInputs {
  const incomingEdges = edges.filter((e) => e.target === targetNode.id)
  const inputs: ResolvedInputs = {}

  for (const edge of incomingEdges) {
    const sourceNode = allNodes.find((n) => n.id === edge.source)
    if (!sourceNode) continue

    // Get output from node state or source node data
    let output: string | undefined
    const state = nodeStates[sourceNode.id]

    if (state?.output) {
      output = getPrimaryOutput(state.output, sourceNode.type, edge.sourceHandle)
    } else if (isSourceNode(sourceNode.type)) {
      const sourceOutput = extractSourceNodeOutput(sourceNode, triggerData)
      if (sourceOutput) {
        output = getPrimaryOutput(sourceOutput, sourceNode.type, edge.sourceHandle)
      }
    }

    if (!output) continue

    // Route the output to the correct input field based on source type + target node type
    routeOutput(inputs, sourceNode, targetNode, output, edge, edges, allNodes, nodeStates)
  }

  return inputs
}

// ---------------------------------------------------------------------------
// Routing helpers — reduce repetition for audio/video target routing
// ---------------------------------------------------------------------------

/** Route an audio output to the correct input field based on target node type. */
function routeAudioOutput(
  inputs: ResolvedInputs,
  output: string,
  targetType: string,
  sourceNodeId: string,
): void {
  if (targetType === "mix-audio") {
    inputs.audioUrls = [...(inputs.audioUrls ?? []), output]
  } else if (targetType === "merge-video-audio") {
    inputs.audioSources = [
      ...(inputs.audioSources ?? []),
      { url: output, sourceNodeId },
    ]
  } else {
    inputs.audioUrl = output
  }
}

/** Route a video output to the correct input field based on target node type. */
function routeVideoOutput(
  inputs: ResolvedInputs,
  output: string,
  targetType: string,
  sourceNodeId: string,
): void {
  if (targetType === "combine-videos") {
    inputs.videoUrls = [...(inputs.videoUrls ?? []), output]
  } else if (targetType === "merge-video-audio") {
    if (!inputs.videoUrl) {
      inputs.videoUrl = output
    } else {
      inputs.audioSources = [
        ...(inputs.audioSources ?? []),
        { url: output, sourceNodeId, sourceType: "video" as const },
      ]
    }
  } else {
    inputs.videoUrl = output
  }
}

// ---------------------------------------------------------------------------
// Media type sets for source type classification
// ---------------------------------------------------------------------------

const TEXT_SOURCE_NODE_TYPES = new Set([
  "text-prompt",
  "list",
  "loop",
  "transcribe",
  "suno-lyrics",
  "image-to-text",
  "forced-alignment",
  "ai-writer",
  "combine-text",
  "split-text",
])

const ENTITY_NODE_TYPES = new Set(["character", "face", "object", "location"])

const VIDEO_OUTPUT_NODE_TYPES = new Set([
  "image-to-video",
  "video-to-video",
  "text-to-video",
  "lip-sync",
  "motion-transfer",
  "video-upscale",
  "suno-music-video",
  "combine-videos",
  "merge-video-audio",
  "add-captions",
  "resize-video",
  "trim-video",
  "render-video",
  "speed-ramp",
  "loop-video",
  "fade-video",
  "transcode-video",
])

const AUDIO_OUTPUT_NODE_TYPES = new Set([
  "text-to-speech",
  "generate-music",
  "text-to-audio",
  "audio-isolation",
  "text-to-dialogue",
  "suno-generate",
  "suno-cover",
  "suno-extend",
  "suno-separate",
  "extract-audio",
  "mix-audio",
  "voice-changer",
  "dubbing",
  "voice-remix",
  "voice-design",
])

const SUNO_TRACK_NODE_TYPES = new Set(["suno-generate", "suno-cover", "suno-extend"])

// ---------------------------------------------------------------------------
// Main routing function
// ---------------------------------------------------------------------------

function routeOutput(
  inputs: ResolvedInputs,
  src: SimpleNode,
  target: SimpleNode,
  output: string,
  edge: SimpleEdge,
  allEdges: SimpleEdge[],
  allNodes: SimpleNode[],
  nodeStates: Record<string, NodeExecutionState>,
): void {
  const srcType = src.type
  const targetType = target.type

  // --- Text/prompt sources ---
  if (TEXT_SOURCE_NODE_TYPES.has(srcType)) {
    inputs.prompt = output
    return
  }

  // --- Upload image ---
  if (srcType === "upload-image") {
    if (targetType === "generate-image") {
      inputs.referenceImageUrls = [...(inputs.referenceImageUrls ?? []), output]
    } else {
      inputs.imageUrl = output
    }
    return
  }

  // --- Entity nodes → reference images (or imageUrl for lip-sync) ---
  if (ENTITY_NODE_TYPES.has(srcType)) {
    if (targetType === "lip-sync") {
      inputs.imageUrl = output
    } else {
      inputs.referenceImageUrls = [...(inputs.referenceImageUrls ?? []), output]
    }
    return
  }

  // --- Upload video / YouTube ---
  if (srcType === "upload-video" || srcType === "youtube-video") {
    if (targetType === "suno-cover" && srcType === "youtube-video") {
      const audioUrl = (src.data.downloadedAudioUrl as string | undefined)?.trim()
      inputs.uploadUrl = audioUrl || output
    } else {
      routeVideoOutput(inputs, output, targetType, src.id)
    }
    return
  }

  // --- Generate image → depends on target ---
  if (srcType === "generate-image") {
    if (targetType === "generate-image") {
      inputs.referenceImageUrls = [...(inputs.referenceImageUrls ?? []), output]
    } else if (targetType === "text-to-audio") {
      inputs.prompt = (src.data.prompt as string) ?? ""
    } else {
      inputs.imageUrl = output
    }
    return
  }

  // --- Edit/I2I image → reference for image nodes, imageUrl for others ---
  if (srcType === "edit-image" || srcType === "image-to-image") {
    if (
      targetType === "generate-image" ||
      targetType === "edit-image" ||
      targetType === "image-to-image"
    ) {
      inputs.referenceImageUrls = [...(inputs.referenceImageUrls ?? []), output]
    } else {
      inputs.imageUrl = output
    }
    return
  }

  // --- Video output nodes ---
  if (VIDEO_OUTPUT_NODE_TYPES.has(srcType)) {
    routeVideoOutput(inputs, output, targetType, src.id)
    return
  }

  // --- Reference audio ---
  if (srcType === "reference-audio") {
    routeAudioOutput(inputs, output, targetType, src.id)
    return
  }

  // --- Upload audio ---
  if (srcType === "upload-audio") {
    routeAudioOutput(inputs, output, targetType, src.id)
    return
  }

  // --- Adjust volume → could be audio or video ---
  if (srcType === "adjust-volume") {
    const lastInputType = (src.data.lastInputType as string | undefined) ?? "audio"
    if (lastInputType === "video") {
      inputs.videoUrl = output
    } else {
      routeAudioOutput(inputs, output, targetType, src.id)
    }
    return
  }

  // --- Audio output nodes ---
  if (AUDIO_OUTPUT_NODE_TYPES.has(srcType)) {
    routeAudioOutput(inputs, output, targetType, src.id)

    // Suno track/task ID passthrough
    if (SUNO_TRACK_NODE_TYPES.has(srcType)) {
      const state = nodeStates[src.id]
      if (state?.output?.sunoTrackId) {
        inputs.sunoTrackId = state.output.sunoTrackId
      }
      if (state?.output?.sunoTaskId) {
        inputs.sunoTaskId = state.output.sunoTaskId
      }
    }
    return
  }

  // --- Scene node ---
  if (srcType === "scene") {
    const state = nodeStates[src.id]
    if (state?.output?.imageUrl) {
      if (targetType === "generate-image") {
        inputs.referenceImageUrls = [...(inputs.referenceImageUrls ?? []), state.output.imageUrl]
      } else {
        inputs.imageUrl = state.output.imageUrl
      }
    }
    if (state?.output?.text) {
      inputs.prompt = state.output.text
    }
    return
  }

  // --- Handle-specific routing (e.g., endFrame) ---
  if (edge.targetHandle === "endFrame") {
    inputs.endFrameUrl = output
    return
  }
  if (edge.targetHandle === "startFrame") {
    inputs.startFrameUrl = output
    return
  }

  // --- Sub-workflow output routing ---
  if (srcType === "sub-workflow" || srcType === "sub-workflow-input") {
    const routeSnapshot = src.data.routeSnapshot as {
      outputPorts?: Array<{ id: string; mediaType: string }>
    } | undefined
    const sourceHandle = edge.sourceHandle

    let mediaType: string | undefined
    if (sourceHandle && routeSnapshot?.outputPorts) {
      const portId = sourceHandle.replace(/^out_/, "")
      const port = routeSnapshot.outputPorts.find((p) => p.id === portId)
      mediaType = port?.mediaType
    }

    if (srcType === "sub-workflow-input") {
      const ports = src.data.ports as Array<{ id: string; mediaType: string }> | undefined
      if (sourceHandle && ports) {
        const port = ports.find((p) => p.id === sourceHandle)
        mediaType = port?.mediaType
      }
    }

    if (mediaType === "image") {
      if (targetType === "generate-image" || targetType === "edit-image" || targetType === "image-to-image") {
        inputs.referenceImageUrls = [...(inputs.referenceImageUrls ?? []), output]
      } else {
        inputs.imageUrl = output
      }
    } else if (mediaType === "video") {
      routeVideoOutput(inputs, output, targetType, src.id)
    } else if (mediaType === "audio") {
      routeAudioOutput(inputs, output, targetType, src.id)
    } else {
      inputs.prompt = output
    }
    return
  }

  // --- Trigger nodes — only set prompt if output looks like real content ---
  if (srcType === "schedule-trigger" || srcType === "webhook-trigger") {
    // Trigger outputs are typically metadata (timestamps, webhook payloads).
    // Only use as prompt if it doesn't look like an ISO timestamp.
    if (output && !/^\d{4}-\d{2}-\d{2}T/.test(output)) {
      inputs.prompt = output
    }
    return
  }

  // Fallback: treat as prompt
  inputs.prompt = output
}
