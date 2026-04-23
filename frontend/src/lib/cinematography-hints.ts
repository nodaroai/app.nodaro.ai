import { buildFramingHints } from "@nodaro-shared/framing"
import { buildLightingHints } from "@nodaro-shared/lighting"
import { getLensPromptHint } from "@nodaro-shared/lens"
import { getCameraFormatPromptHint } from "@nodaro-shared/camera-format"
import { getColorLookPromptHint } from "@nodaro-shared/color-look"
import { getAtmospherePromptHint } from "@nodaro-shared/atmosphere"
import { buildTemporalHints } from "@nodaro-shared/temporal"
import { composeCameraMotionHintFromConnections } from "@nodaro-shared/camera-motions"
import type { WorkflowNode, WorkflowEdge } from "@/types/nodes"

/**
 * Dispatch by parameter-node type to that node's prompt-hint string. Used by
 * both the frontend DAG executor (when injecting camera-motion's start/end
 * clauses into a consumer's prompt) and the camera-motion config panel
 * preview (so users can see exactly what the connected nodes will contribute).
 */
export function getNodePromptHint(node: WorkflowNode | undefined): string {
  if (!node) return ""
  const data = node.data as Record<string, unknown>
  switch (node.type) {
    case "framing": {
      const hints = buildFramingHints(data)
      return hints.join(", ")
    }
    case "lighting": {
      const hints = buildLightingHints(data)
      return hints.join(", ")
    }
    case "lens":
      return getLensPromptHint(typeof data.lens === "string" ? data.lens : "")
    case "camera-format":
      return getCameraFormatPromptHint(typeof data.cameraFormat === "string" ? data.cameraFormat : "")
    case "color-look":
      return getColorLookPromptHint(typeof data.colorLook === "string" ? data.colorLook : "")
    case "atmosphere":
      return getAtmospherePromptHint(typeof data.atmosphere === "string" ? data.atmosphere : "")
    case "temporal": {
      const hints = buildTemporalHints(data)
      return hints.join(", ")
    }
    case "tone":
      return typeof data.tone === "string" ? data.tone.trim() : ""
    case "text-prompt":
      return typeof data.text === "string" ? data.text.trim() : ""
    default:
      return ""
  }
}

/**
 * Compose the full structured camera-motion prompt for a given motion id by
 * walking incoming edges to the camera-motion node to find what's connected
 * to its `startState` and `endState` input handles, dispatching each
 * connected node through {@link getNodePromptHint}.
 *
 * Returns the bare motion hint when no connections exist.
 */
export function composeCameraMotionHintForNode(
  motionId: string | undefined,
  cameraMotionNodeId: string | undefined,
  nodes: ReadonlyArray<WorkflowNode>,
  edges: ReadonlyArray<WorkflowEdge>,
): string {
  if (!cameraMotionNodeId) {
    return composeCameraMotionHintFromConnections(motionId, [], [])
  }
  const startHints: string[] = []
  const endHints: string[] = []
  for (const edge of edges) {
    if (edge.target !== cameraMotionNodeId) continue
    const srcNode = nodes.find((n) => n.id === edge.source)
    if (!srcNode) continue
    const hint = getNodePromptHint(srcNode)
    if (!hint) continue
    if (edge.targetHandle === "startState") startHints.push(hint)
    else if (edge.targetHandle === "endState") endHints.push(hint)
  }
  return composeCameraMotionHintFromConnections(motionId, startHints, endHints)
}
