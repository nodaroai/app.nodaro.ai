import { buildFramingHints } from "@nodaro-shared/framing"
import { buildLightingHints } from "@nodaro-shared/lighting"
import { getLensPromptHint } from "@nodaro-shared/lens"
import { getCameraFormatPromptHint } from "@nodaro-shared/camera-format"
import { getColorLookPromptHint } from "@nodaro-shared/color-look"
import { getAtmospherePromptHint } from "@nodaro-shared/atmosphere"
import { getStylePromptHint } from "@nodaro-shared/style"
import { getSettingPromptHint } from "@nodaro-shared/setting"
import { buildPersonHints } from "@nodaro-shared/person"
import { buildMoodHints } from "@nodaro-shared/mood"
import { buildPoseHints } from "@nodaro-shared/pose"
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
    case "style":
      return getStylePromptHint(typeof data.style === "string" ? data.style : "")
    case "setting":
      return getSettingPromptHint(typeof data.setting === "string" ? data.setting : "")
    case "person": {
      const hints = buildPersonHints(data)
      return hints.join(", ")
    }
    case "mood": {
      const hints = buildMoodHints(data)
      return hints.join(", ")
    }
    case "pose": {
      const hints = buildPoseHints(data)
      return hints.join(", ")
    }
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

/**
 * Walk a consumer node's `cinematography` target handle and aggregate one
 * prompt-hint string per connected source. Camera-motion sources are composed
 * via their own startState/endState walk (they produce the full structured
 * "beginning with X, ending with Y" sentence); all other parameter nodes
 * dispatch through {@link getNodePromptHint}.
 *
 * Returns an array of non-empty hint strings — the caller decides how to join
 * and append them onto the user prompt. Used by:
 *  - the frontend DAG executor (appends to each AI gen node's prompt),
 *  - the backend workflow-engine payload builder (same),
 *  - the FinalPromptPreview + ConnectedCinematographySources UI components.
 */
/** Video-only cinematography dims. Still-image consumers (generate-image,
 *  edit-image, image-to-image, Location entity reference-image gen) pass
 *  these via `options.excludeTypes` to `collectCinematographyHints` so a
 *  stray Motion/Temporal connection doesn't inject incoherent hints. */
export const STILL_IMAGE_EXCLUDE_TYPES: ReadonlySet<string> = new Set(["camera-motion", "temporal"])

export function collectCinematographyHints(
  consumerNodeId: string,
  nodes: ReadonlyArray<WorkflowNode>,
  edges: ReadonlyArray<WorkflowEdge>,
  options?: { excludeTypes?: ReadonlySet<string> },
): string[] {
  const hints: string[] = []
  const exclude = options?.excludeTypes
  for (const edge of edges) {
    if (edge.target !== consumerNodeId) continue
    if (edge.targetHandle !== "cinematography") continue
    const srcNode = nodes.find((n) => n.id === edge.source)
    if (!srcNode) continue
    if (exclude?.has(srcNode.type ?? "")) continue

    if (srcNode.type === "camera-motion") {
      const motionId = (srcNode.data as Record<string, unknown>).cameraMotion as string | undefined
      const composed = composeCameraMotionHintForNode(motionId, srcNode.id, nodes, edges)
      if (composed) hints.push(composed)
      continue
    }

    const hint = getNodePromptHint(srcNode)
    if (hint) hints.push(hint)
  }
  return hints
}

/**
 * True when the consumer node has a connected Style parameter node on its
 * `cinematography` handle. Used to bypass the inline Style dropdown in image
 * config panels — when the user wires a Style node, the node's richer
 * promptHint takes over and the inline field is disabled.
 */
export function hasConnectedStyleNode(
  consumerNodeId: string | undefined,
  nodes: ReadonlyArray<WorkflowNode>,
  edges: ReadonlyArray<WorkflowEdge>,
): boolean {
  if (!consumerNodeId) return false
  for (const edge of edges) {
    if (edge.target !== consumerNodeId) continue
    if (edge.targetHandle !== "cinematography") continue
    const srcNode = nodes.find((n) => n.id === edge.source)
    if (srcNode?.type === "style") return true
  }
  return false
}
