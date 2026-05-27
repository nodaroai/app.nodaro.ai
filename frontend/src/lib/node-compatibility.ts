import type { SceneNodeType } from "@/types/nodes"
import { NODE_DEF_MAP } from "@/types/nodes"
import type { XYPosition } from "@xyflow/react"
import { VISUAL_PARAMETER_PICKER_NODE_TYPES } from "./parameter-picker-types"
import { IDENTITY_TYPES, IMAGE_PRODUCER_TYPES } from "./generate-image-handles"
import { ACCEPTS_PARAMETER_PICKER, TARGET_HANDLE_ACCEPTS } from "./target-handle-registry"
import { FFMPEG_NODE_TYPES, isValidFfmpegConnection } from "./ffmpeg-handles"

/** Source node types whose source-direction candidate enumeration must
 *  consult the typed accepts predicates in `target-handle-registry.ts`
 *  rather than the loose `HANDLE_COMPATIBILITY` map. Keeping these two
 *  paths in sync prevents the add-node popup from suggesting targets the
 *  drop-time validator then rejects. */
const TYPED_SOURCE_NODE_TYPES: ReadonlySet<string> = new Set([
  "list", "loop", "web-scrape", "extract-field", "filter-list",
  "deduplicate", "merge-lists", "sort-list",
])

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
 *  character-fx vs the 11 ffmpeg consumers). Drives the dev-time warning
 *  when the call site omits consumerNodeType — without it, the branches
 *  fall through to generic HANDLE_COMPATIBILITY which produces the wrong
 *  candidate set. */
export const TYPED_HANDLE_IDS: ReadonlySet<string> = new Set(["startState", "endState", "target", "in"])
const CONSUMER_TYPE_DEPENDENT_HANDLES = TYPED_HANDLE_IDS

/** Subset of TYPED_HANDLE_IDS whose typed dispatch requires Parameter-
 *  category candidates (tone, style-guide, person, lens, etc.) — which
 *  are otherwise hidden from the add-node popup via `n.category !==
 *  "Parameter"`. The add-node popup uses this narrower set to decide
 *  whether to swap `visibleNodes` for the unfiltered `typedHandlePool`.
 *
 *  - `startState` / `endState` → camera-motion / transition; accept
 *    visual pickers (Parameter category).
 *  - `target` → character-fx; accepts identity refs (NOT Parameter, but
 *    kept here for forward-compat since the previous behavior used the
 *    broader set).
 *
 *  Crucially, `"in"` is OMITTED. ffmpeg consumers' `in` handle does not
 *  accept Parameter-category nodes — its candidates are video/audio/
 *  dynamic producers, all in core categories. Including "in" here would
 *  surface tone / lens / mood / etc. as compatible suggestions on every
 *  non-ffmpeg `in` handle (text-to-speech, voice-*, motion-graphics,
 *  after-effects, transcribe, etc.) — false-positive UX. */
export const PARAMETER_ACCEPTING_HANDLE_IDS: ReadonlySet<string> = new Set([
  "startState", "endState", "target",
])

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

  // Data-category sources (list, loop, web-scrape, extract-field,
  // filter-list, deduplicate, merge-lists, sort-list): walk
  // TARGET_HANDLE_ACCEPTS to find every option whose typed target handle
  // accepts this source type. Aligns the add-node popup with the canvas
  // validator + popover candidate enumeration (which both consult the
  // same registry). Without this branch, the popup would fall through to
  // HANDLE_COMPATIBILITY which has loose entries like
  // `json: ["json","in","text","prompt"]` and would suggest media nodes
  // that the new data-handles.ts predicates then reject at drop time.
  if (direction === "source" && consumerNodeType && TYPED_SOURCE_NODE_TYPES.has(consumerNodeType)) {
    const direct: NodeOption[] = []
    const directTypes = new Set<SceneNodeType>()
    for (const option of nodeOptions) {
      // Skip the source node's own type — self-loops are rejected by the
      // cycle guard anyway and surfacing them in the popup is just noise.
      if (option.type === consumerNodeType) continue
      const entries = TARGET_HANDLE_ACCEPTS[option.type]
      if (!entries) continue
      if (entries.some((e) => e.accepts(consumerNodeType))) {
        direct.push(option)
        directTypes.add(option.type)
      }
    }
    // `compatible: []` is intentional — strict typing for data-category
    // sources. Any node that legitimately consumes a data-node output
    // MUST be registered in TARGET_HANDLE_ACCEPTS to appear in this
    // popup. The pre-fix HANDLE_COMPATIBILITY fallthrough populated a
    // fuzzy "compatible" tier that included media nodes the validator
    // then rejected at drop time; removing it eliminates that mismatch.
    return { direct, compatible: [], directTypes }
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
  // Uses the shared IMAGE_PRODUCER_TYPES (single source of truth — same
  // set drives isValidGenerateImageConnection at the canvas validator) so
  // popup candidates and drag-to-connect can't diverge.
  if (handleId === "references" && direction === "target") {
    const direct: NodeOption[] = []
    const directTypes = new Set<SceneNodeType>()
    for (const option of nodeOptions) {
      if (!IMAGE_PRODUCER_TYPES.has(option.type)) continue
      direct.push(option)
      directTypes.add(option.type)
    }
    return { direct, compatible: [], directTypes }
  }

  // Generate Image v2.1: Assets handle accepts only identity-locking nodes.
  // (Legacy alias `subjects` also matched here pre-v2.1 rename.) Uses the
  // shared IDENTITY_TYPES from generate-image-handles for single-source-
  // of-truth — previously had a local literal that shadowed the import
  // and would silently drift if new identity types landed in the canonical set.
  if ((handleId === "assets" || handleId === "subjects") && direction === "target") {
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

  // FFmpeg consumers' `in` handle — dispatch through
  // isValidFfmpegConnection so the popup's typed-candidate list agrees
  // with the canvas validator (no "popup suggests X, drag rejects X"
  // inconsistency). The 11 ffmpeg target types each route a single
  // `in` handle through ACCEPTS_VIDEO / ACCEPTS_AUDIO / ACCEPTS_MEDIA.
  if (
    consumerNodeType !== undefined
    && FFMPEG_NODE_TYPES.has(consumerNodeType)
    && direction === "target"
    && handleId === "in"
  ) {
    const direct: NodeOption[] = []
    const directTypes = new Set<SceneNodeType>()
    for (const option of nodeOptions) {
      if (!isValidFfmpegConnection(consumerNodeType, handleId, option.type)) continue
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
    // Loop AND list nodes use "col_add" quick-add. The col_add handler in
    // use-workflow-store auto-detects the column type from the source AND
    // sets column[0].connectedSourceId / type / name. Routing to the
    // static "in" pip instead would leave column metadata unset, which
    // breaks clearConnectedListRows (run-handlers.ts) on subsequent runs
    // and confuses any later col_add drop (soleEmptyCol check would still
    // see col[0] as empty and clobber it). The popover Connect button
    // still wires to "in" directly (via TARGET_HANDLE_ACCEPTS) — that
    // path is the passthrough flow and doesn't need column metadata.
    if (nodeType === "loop" || nodeType === "list") return "col_add"
    return def.inputs.find((h) => compatible.includes(h)) ?? "in"
  } else {
    return def.outputs.find((h) => compatible.includes(h)) ?? def.outputs[0] ?? "out"
  }
}
