import type { SceneNodeType } from "@/types/nodes"
import { NODE_DEF_MAP } from "@/types/nodes"
import type { XYPosition } from "@xyflow/react"

export interface ConnectionContext {
  readonly nodeId: string
  readonly handleId: string
  readonly direction: "source" | "target"
  readonly dropPosition: XYPosition
}

/**
 * Maps a handle ID to the set of handle IDs it can connect to.
 * Used for "direct match" tier — cross-type compatibility
 * (e.g., image output → startFrame input).
 */
export const HANDLE_COMPATIBILITY: Record<string, readonly string[]> = {
  // Media outputs → typed media inputs
  image: ["image", "startFrame", "endFrame", "background", "media"],
  video: ["video", "video1", "video2", "video3", "video4", "media", "background"],
  audio: ["audio", "audio1", "audio2", "audio3", "audio4", "audio5", "ref-audio", "media"],
  "silent-video": ["video", "video1", "video2", "video3", "video4", "media"],

  // Text-like outputs → text-like inputs
  prompt: ["prompt", "text"],
  script: ["prompt", "text"],
  text: ["text", "prompt", "in"],
  content: ["text", "prompt", "in"],
  scenes: ["in"],

  // Entity references → exact match only
  characterRef: ["characterRef"],
  faceRef: ["faceRef"],
  objectRef: ["objectRef"],
  locationRef: ["locationRef"],

  // JSON outputs → json or text-like inputs (auto-stringify at runtime)
  json: ["json", "in", "text", "prompt"],

  // Specialized
  voiceId: ["voiceId"],
  composition: ["composition"],
  narration: ["audio", "ref-audio", "media"],
  dialogue: ["audio", "ref-audio", "media"],
  imageRefs: ["image", "in"],
  list: ["list", "in"],
  data: ["data", "in"],
  payload: ["data", "in"],
  media: ["media", "in"],
  asset: ["in"],

  // Generic outputs
  out: ["in"],
  approved: ["in"],
  rejected: ["in"],
}


export interface NodeOption {
  readonly type: SceneNodeType
  readonly label: string
  readonly icon: React.ReactNode
  readonly category: string
  readonly group?: string
  readonly adminOnly?: boolean
}

export interface CompatibleNodes {
  readonly direct: NodeOption[]
  readonly compatible: NodeOption[]
  readonly directTypes: ReadonlySet<SceneNodeType>
}

export function getCompatibleNodes(
  handleId: string,
  direction: "source" | "target",
  nodeOptions: readonly NodeOption[],
): CompatibleNodes {
  const compatibleSet = new Set(HANDLE_COMPATIBILITY[handleId] ?? [handleId])

  const direct: NodeOption[] = []
  const compatible: NodeOption[] = []
  const directTypes = new Set<SceneNodeType>()

  // Single pass: classify each node as direct, compatible, or neither
  for (const option of nodeOptions) {
    const def = NODE_DEF_MAP.get(option.type)
    if (!def) continue

    const handlesToCheck = direction === "source" ? def.inputs : def.outputs
    const hasDirectMatch = handlesToCheck.some((h) => compatibleSet.has(h))

    if (hasDirectMatch) {
      direct.push(option)
      directTypes.add(option.type)
    } else {
      const hasGeneric = direction === "source"
        ? handlesToCheck.includes("in")
        : handlesToCheck.length > 0
      if (hasGeneric) {
        compatible.push(option)
      }
    }
  }

  return { direct, compatible, directTypes }
}

export function resolveTargetHandle(
  nodeType: SceneNodeType,
  sourceHandleId: string,
  direction: "source" | "target",
): string {
  const def = NODE_DEF_MAP.get(nodeType)
  if (!def) return direction === "source" ? "in" : "out"

  const compatible = HANDLE_COMPATIBILITY[sourceHandleId] ?? [sourceHandleId]

  if (direction === "source") {
    // Loop/list nodes use "col_add" quick-add handle (not static "in")
    if (nodeType === "loop" || nodeType === "list") return "col_add"
    return def.inputs.find((h) => compatible.includes(h)) ?? "in"
  } else {
    return def.outputs.find((h) => compatible.includes(h)) ?? def.outputs[0] ?? "out"
  }
}
