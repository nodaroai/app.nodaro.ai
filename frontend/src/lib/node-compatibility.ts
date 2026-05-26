import type { SceneNodeType } from "@/types/nodes"
import { NODE_DEF_MAP } from "@/types/nodes"
import type { XYPosition } from "@xyflow/react"
import { VISUAL_PARAMETER_PICKER_NODE_TYPES } from "./parameter-picker-types"
import { IDENTITY_TYPES } from "./generate-image-handles"
import { ACCEPTS_PARAMETER_PICKER } from "./target-handle-registry"

export interface ConnectionContext {
  readonly nodeId: string
  readonly handleId: string
  readonly direction: "source" | "target"
  readonly dropPosition: XYPosition
  /** Node type of the source/consumer the user dragged from. Used by
   *  `getCompatibleNodes` to refine the filter on context-sensitive handles
   *  (e.g. `cinematography` hides motion-only pickers for still-image
   *  consumers). Optional for legacy call sites that don't have it. */
  readonly nodeType?: string
}

/** Still-image consumer node types — their `cinematography` handle excludes
 *  motion-only pickers (mirrors `STILL_IMAGE_EXCLUDE_TYPES` in
 *  `cinematography-hints.ts`). */
const STILL_IMAGE_CONSUMERS: ReadonlySet<string> = new Set([
  "generate-image", "modify-image", "image-to-image", "edit-image", "location",
])

const MOTION_ONLY_PICKER_TYPES: ReadonlySet<string> = new Set([
  "camera-motion", "transition", "temporal", "character-fx",
])

/**
 * Maps a handle ID to the set of handle IDs it can connect to.
 * Used for "direct match" tier — cross-type compatibility
 * (e.g., image output → startFrame input).
 */
export const HANDLE_COMPATIBILITY: Record<string, readonly string[]> = {
  // Media outputs → typed media inputs
  image: ["image", "startFrame", "endFrame", "background", "media", "face"],
  video: ["video", "video1", "video2", "video3", "video4", "media", "background", "in"],
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
  faceRef: ["faceRef", "face"],
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
  /** Optional alternative search terms surfaced by the popup's filter (in addition to label / type / category). */
  readonly keywords?: readonly string[]
}

export interface CompatibleNodes {
  readonly direct: NodeOption[]
  readonly compatible: NodeOption[]
  readonly directTypes: ReadonlySet<SceneNodeType>
}

/** Handle ids whose typed-handle branches in getCompatibleNodes require
 *  `consumerNodeType` to disambiguate (camera-motion vs transition vs
 *  character-fx). Dev-time warning when this is omitted — the branch
 *  silently falls through to the generic HANDLE_COMPATIBILITY path and
 *  the call site may not notice.
 *
 *  Single source of truth — also re-exported as TYPED_HANDLE_IDS for the
 *  add-node popup's typed-pool inclusion check. Don't duplicate the
 *  literal set inline elsewhere; import from here. */
export const TYPED_HANDLE_IDS: ReadonlySet<string> = new Set(["startState", "endState", "target"])
const CONSUMER_TYPE_DEPENDENT_HANDLES = TYPED_HANDLE_IDS

export function getCompatibleNodes(
  handleId: string,
  direction: "source" | "target",
  nodeOptions: readonly NodeOption[],
  consumerNodeType?: string,
): CompatibleNodes {
  // Dev-time warning: typed-handle branches below (camera-motion's
  // startState/endState, character-fx's target) all require
  // consumerNodeType to dispatch. Without it, we silently fall through
  // to the generic HANDLE_COMPATIBILITY map — which has no entry for
  // these IDs, so it produces the wrong candidate set. Warn loudly in
  // dev so the call site can pass the missing arg.
  if (
    direction === "target" &&
    !consumerNodeType &&
    CONSUMER_TYPE_DEPENDENT_HANDLES.has(handleId) &&
    // Dev-only warn — Vite sets MODE=development in dev, production in
    // built artifacts. The previous `typeof import.meta !== "undefined"`
    // check was dead (import.meta is always defined in Vite/ESM bundles
    // and would be a static parse error otherwise), so it was removed.
    import.meta.env?.DEV
  ) {
    console.warn(
      `[getCompatibleNodes] handleId='${handleId}' requires consumerNodeType but none provided. ` +
      `Typed-handle branches will be skipped, returning generic fallback. ` +
      `Pass connectionContext.nodeType from the caller.`,
    )
  }

  // Special-case: the `cinematography` / `style` target handle accepts only
  // parameter-picker nodes. v2.1 splits this into `look` and `scene`, but
  // the legacy IDs still resolve here for backwards compat (pre-migration
  // workflows).
  if ((handleId === "cinematography" || handleId === "style") && direction === "target") {
    const excludeMotion = consumerNodeType !== undefined
      && STILL_IMAGE_CONSUMERS.has(consumerNodeType)
    const direct: NodeOption[] = []
    const directTypes = new Set<SceneNodeType>()
    for (const option of nodeOptions) {
      if (!VISUAL_PARAMETER_PICKER_NODE_TYPES.has(option.type)) continue
      if (excludeMotion && MOTION_ONLY_PICKER_TYPES.has(option.type)) continue
      direct.push(option)
      directTypes.add(option.type)
    }
    return { direct, compatible: [], directTypes }
  }

  // Generate Image v2.1: Look handle (cinematography/camera family pickers).
  if (handleId === "look" && direction === "target") {
    const LOOK_TYPES: ReadonlySet<string> = new Set([
      "setting", "atmosphere", "style", "color-look", "mood", "photographer",
      "aesthetic", "era", "photo-genre", "backdrop", "render-quality",
      "composition-effects", "action-fx", "loop-subject", "post-process-effects",
      "tone", "camera-motion", "lens", "camera-format", "framing", "lighting",
      "exposure-settings", "temporal", "transition", "character-fx",
    ])
    const excludeMotion = consumerNodeType !== undefined && STILL_IMAGE_CONSUMERS.has(consumerNodeType)
    const direct: NodeOption[] = []
    const directTypes = new Set<SceneNodeType>()
    for (const option of nodeOptions) {
      if (!LOOK_TYPES.has(option.type)) continue
      if (excludeMotion && MOTION_ONLY_PICKER_TYPES.has(option.type)) continue
      direct.push(option)
      directTypes.add(option.type)
    }
    return { direct, compatible: [], directTypes }
  }

  // Generate Image v2.1: Elements handle (Subject / Object family + instrumentation).
  if (handleId === "elements" && direction === "target") {
    const ELEMENTS_TYPES: ReadonlySet<string> = new Set([
      "person", "pose", "animal", "vehicle", "weapon", "furniture", "material",
      "held-prop", "styling", "instrumentation",
    ])
    const direct: NodeOption[] = []
    const directTypes = new Set<SceneNodeType>()
    for (const option of nodeOptions) {
      if (!ELEMENTS_TYPES.has(option.type)) continue
      direct.push(option)
      directTypes.add(option.type)
    }
    return { direct, compatible: [], directTypes }
  }

  // Generate Image v2: References accepts only image-producing nodes.
  if (handleId === "references" && direction === "target") {
    const IMAGE_TYPES: ReadonlySet<string> = new Set([
      "upload-image", "generate-image", "edit-image", "image-to-image",
      "modify-image", "upscale-image", "remove-background",
    ])
    const direct: NodeOption[] = []
    const directTypes = new Set<SceneNodeType>()
    for (const option of nodeOptions) {
      if (!IMAGE_TYPES.has(option.type)) continue
      direct.push(option)
      directTypes.add(option.type)
    }
    return { direct, compatible: [], directTypes }
  }

  // Generate Image v2.1: Assets handle accepts only identity-locking nodes.
  // (Legacy alias `subjects` also matched here pre-v2.1 rename.)
  if ((handleId === "assets" || handleId === "subjects") && direction === "target") {
    const IDENTITY_TYPES: ReadonlySet<string> = new Set(["character", "location", "object", "face"])
    const direct: NodeOption[] = []
    const directTypes = new Set<SceneNodeType>()
    for (const option of nodeOptions) {
      if (!IDENTITY_TYPES.has(option.type)) continue
      direct.push(option)
      directTypes.add(option.type)
    }
    return { direct, compatible: [], directTypes }
  }

  // Generate Image v2: Prompt accepts text producers + all visual parameter
  // pickers (as `{Label}` variable sources; the wire is visual per the v2 design).
  if (handleId === "prompt" && direction === "target") {
    const TEXT_TYPES: ReadonlySet<string> = new Set([
      "text-prompt", "ai-writer", "llm-chat", "generate-script",
      "combine-text", "image-to-text", "split-text",
    ])
    const direct: NodeOption[] = []
    const compatible: NodeOption[] = []
    const directTypes = new Set<SceneNodeType>()
    for (const option of nodeOptions) {
      if (TEXT_TYPES.has(option.type)) {
        direct.push(option)
        directTypes.add(option.type)
      } else if (VISUAL_PARAMETER_PICKER_NODE_TYPES.has(option.type)) {
        compatible.push(option)
      }
    }
    return { direct, compatible, directTypes }
  }

  // Generate Image v2: Negative accepts text producers only (pickers as
  // variable sources work via workflow-wide {Label}, no wire needed).
  if (handleId === "negative" && direction === "target") {
    const TEXT_TYPES: ReadonlySet<string> = new Set([
      "text-prompt", "ai-writer", "llm-chat", "generate-script",
      "combine-text", "image-to-text", "split-text",
    ])
    const direct: NodeOption[] = []
    const directTypes = new Set<SceneNodeType>()
    for (const option of nodeOptions) {
      if (!TEXT_TYPES.has(option.type)) continue
      direct.push(option)
      directTypes.add(option.type)
    }
    return { direct, compatible: [], directTypes }
  }

  // Camera Motion / Transition: startState + endState handles accept
  // hint-producer nodes (visual pickers + tone + text-prompt). Mirrors
  // ACCEPTS_PARAMETER_PICKER in target-handle-registry — the same
  // predicate drives the canvas validator and the drag-glow.
  if (
    (consumerNodeType === "camera-motion" || consumerNodeType === "transition") &&
    direction === "target" &&
    (handleId === "startState" || handleId === "endState")
  ) {
    const direct: NodeOption[] = []
    const directTypes = new Set<SceneNodeType>()
    for (const option of nodeOptions) {
      if (!ACCEPTS_PARAMETER_PICKER(option.type)) continue
      direct.push(option)
      directTypes.add(option.type)
    }
    return { direct, compatible: [], directTypes }
  }

  // Character FX: the `target` handle accepts identity-locking ref nodes
  // only (character / face / object / location). See ACCEPTS_CHARACTER_REF
  // in target-handle-registry; the shared hint-builder reads characterName
  // / faceName / objectName / locationName from the source.
  if (consumerNodeType === "character-fx" && direction === "target" && handleId === "target") {
    const direct: NodeOption[] = []
    const directTypes = new Set<SceneNodeType>()
    for (const option of nodeOptions) {
      if (!IDENTITY_TYPES.has(option.type)) continue
      direct.push(option)
      directTypes.add(option.type)
    }
    return { direct, compatible: [], directTypes }
  }

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
