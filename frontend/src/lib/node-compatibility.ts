import type { SceneNodeType } from "@/types/nodes"
import { NODE_DEF_MAP } from "@/types/nodes"
import type { XYPosition } from "@xyflow/react"
import { VISUAL_PARAMETER_PICKER_NODE_TYPES } from "./parameter-picker-types"
import { IDENTITY_TYPES, IMAGE_PRODUCER_TYPES, TEXT_PRODUCER_TYPES } from "./generate-image-handles"
import { ACCEPTS_PARAMETER_PICKER, TARGET_HANDLE_ACCEPTS } from "./target-handle-registry"
import { FFMPEG_NODE_TYPES, isValidFfmpegConnection } from "./ffmpeg-handles"
import { AUDIO_PRODUCER_TYPES, VIDEO_PRODUCER_TYPES } from "@nodaro/shared"
import { AUDIO_PICKER_TYPES, VOICE_PERSONA_TYPES } from "./audio-text-handles"

// `voice` target accepts voice-persona producers (suno-voice, voice-design's
// voiceId output) AND voice-character (a parameter picker — surfaced as
// direct match in the add-node popup so the user sees it as a primary
// candidate).
const VOICE_TARGET_TYPES: ReadonlySet<string> = new Set<string>([...VOICE_PERSONA_TYPES, "voice-character"])

/** Source node types whose source-direction candidate enumeration must
 *  consult the typed accepts predicates in `target-handle-registry.ts`
 *  rather than the loose `HANDLE_COMPATIBILITY` map. Keeping these two
 *  paths in sync prevents the add-node popup from suggesting targets the
 *  drop-time validator then rejects. */
const TYPED_SOURCE_NODE_TYPES: ReadonlySet<string> = new Set([
  "list", "web-scrape", "extract-field", "filter-list",
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
  /** Hex color of the handle the menu was opened from (its `--pip-color`).
   *  Used to tint the add-node menu's "Connect to" title in the handle's own
   *  type color. Optional — falls back to the default accent when absent. */
  readonly color?: string
  /** When set, the node created from this menu is pre-named to this value
   *  (written to the type's name field via buildPrefillInitialData) so a
   *  dangling prompt reference like `{Hero}` resolves once it's wired. */
  readonly prefillName?: string
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
  image: ["image", "startFrame", "endFrame", "background", "media", "face", "ref-image"],
  video: ["video", "video1", "video2", "video3", "video4", "media", "background", "ref-video", "in"],
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
 *  character-fx vs the 11 ffmpeg consumers), AND handle ids whose dispatch
 *  doesn't need consumer-type discrimination but still goes through a
 *  typed branch instead of the generic HANDLE_COMPATIBILITY map (Batch 1-4
 *  of the audio/text typed-handles migration). The popup uses the full
 *  set to decide which handle ids are "typed" enough to bypass the
 *  Parameter-category filter; the dev-time warning uses the narrower
 *  consumer-type-dependent subset below. */
export const TYPED_HANDLE_IDS: ReadonlySet<string> = new Set([
  // Camera-motion / transition + character-fx handles (consumer-type-
  // dependent dispatch; requires `consumerNodeType`).
  "startState", "endState", "target", "in",
  // Audio & Speech handles (Batch 1 of audio/text typed-handles migration).
  "prompt", "audio", "audio-style", "ref-audio", "voice", "transcript",
  // Suno mashup ordered audio inputs (Batch 2).
  "audio1", "audio2",
  // llm-chat secondary inputs (Batch 3).
  "references", "system-prompt",
  // Processing handles (Batch 4, non-ffmpeg-overlapping). `text` is
  // combine-text / split-text; `video` is split-media; `media` already
  // covered by ffmpeg's adjust-volume entry.
  "text", "video",
  // filter-list / selector `variables` handle — accepts any data producer
  // for ref resolution via buildConditionVariables. Selector's addition in
  // T19+ extended the registry; this set must mirror TARGET_HANDLE_ACCEPTS.
  "variables",
  // Image-producer handles (Phase 20). `image` covers edit/modify/i2i/
  // generate-mask/upscale/remove-background/image-to-text targets;
  // `mask` is edit/modify/i2i; `cinematography` is edit/modify/i2i;
  // `face` is face-swap. The `video` id above also covers face-swap.
  "image", "mask", "cinematography", "face",
  // Identity-node handles (Phase 23). `in` already covered above; `type`
  // is object-node-specific (accepts identity-type pickers).
  "type",
  // ai-avatar verbatim spoken-script handle — text producers only (no pickers,
  // no cinematography). Distinct from `prompt` so spoken text never gets
  // parameter-picker prose appended.
  "script",
  // cinematic-avatar optional reference handles — one upstream producer each,
  // resolved into HeyGen's `references` array. `ref-audio` is already covered
  // above (generate-music); `ref-video` / `ref-image` are typed video / image
  // inputs that bypass the Parameter-category filter like the other media
  // handles.
  "ref-video", "ref-image",
])
/** Subset that requires consumer-type dispatch — the dev-time warning in
 *  getCompatibleNodes triggers when one of these is passed without a
 *  consumerNodeType, because their branches dispatch on consumer type to
 *  return the right candidate set. The rest of TYPED_HANDLE_IDS dispatch
 *  uniformly (no consumer-type discrimination needed). */
const CONSUMER_TYPE_DEPENDENT_HANDLES: ReadonlySet<string> = new Set(["startState", "endState", "target", "in"])

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
  // Image-producer legacy `cinematography` handle accepts visual pickers
  // (camera, look, elements). The existing getCompatibleNodes branch
  // (handleId === "cinematography" || "style") routes to picker candidates;
  // include here so the add-node popup swaps `visibleNodes` for the
  // unfiltered `typedHandlePool` (which surfaces Parameter-category nodes).
  "cinematography",
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

  // Audio & Speech typed-handle dispatch (Batch 1 of audio/text migration).
  // For nodes whose `audio` target accepts audio-or-video producers
  // (dubbing, transcribe — both backends extract audio from video
  // transparently), the consumer-type discriminator widens the candidate
  // pool; otherwise audio-only producers.
  if (direction === "target" && handleId === "audio") {
    const includeVideo = consumerNodeType === "dubbing" || consumerNodeType === "transcribe"
    // suno-cover also accepts youtube-video as audio (backend extracts the
    // audio track per input-resolver.ts:1287). youtube-video is in
    // VIDEO_PRODUCER_TYPES so the video toggle wouldn't catch it for
    // suno-cover; special-case here.
    const includeYouTube = consumerNodeType === "suno-cover"
    const direct: NodeOption[] = []
    const directTypes = new Set<SceneNodeType>()
    for (const option of nodeOptions) {
      const isAudio = AUDIO_PRODUCER_TYPES.has(option.type)
      const isVideo = includeVideo && VIDEO_PRODUCER_TYPES.has(option.type)
      const isYouTube = includeYouTube && option.type === "youtube-video"
      if (!isAudio && !isVideo && !isYouTube) continue
      direct.push(option)
      directTypes.add(option.type)
    }
    return { direct, compatible: [], directTypes }
  }

  // `ref-audio` accepts audio producers only — used by generate-music's
  // reference-audio slot.
  if (direction === "target" && handleId === "ref-audio") {
    const direct: NodeOption[] = []
    const directTypes = new Set<SceneNodeType>()
    for (const option of nodeOptions) {
      if (!AUDIO_PRODUCER_TYPES.has(option.type)) continue
      direct.push(option)
      directTypes.add(option.type)
    }
    return { direct, compatible: [], directTypes }
  }

  // `audio-style` accepts audio-domain pickers (music-genre / music-mood /
  // instrumentation / voice-character / voice-delivery) plus tone +
  // text-prompt — same set as AUDIO_PICKER_TYPES in audio-text-handles.ts.
  if (direction === "target" && handleId === "audio-style") {
    const direct: NodeOption[] = []
    const directTypes = new Set<SceneNodeType>()
    for (const option of nodeOptions) {
      if (!AUDIO_PICKER_TYPES.has(option.type)) continue
      direct.push(option)
      directTypes.add(option.type)
    }
    return { direct, compatible: [], directTypes }
  }

  // `voice` (suno-generate / suno-cover / suno-extend) accepts voice-
  // persona producers (suno-voice, voice-character, voice-design's voiceId
  // output). voice-character is a picker AND a producer — treated as a
  // direct match here so the popup surfaces it.
  if (direction === "target" && handleId === "voice") {
    const direct: NodeOption[] = []
    const directTypes = new Set<SceneNodeType>()
    for (const option of nodeOptions) {
      if (!VOICE_TARGET_TYPES.has(option.type)) continue
      direct.push(option)
      directTypes.add(option.type)
    }
    return { direct, compatible: [], directTypes }
  }

  // `text` (Batch 4: combine-text + split-text). combine-text accepts
  // text producers + visual pickers (as text-fragment producers);
  // split-text only accepts text producers. The popup can't distinguish
  // by consumer type here without consumerNodeType, so we return the
  // permissive set (text + visual pickers). The canvas validator's
  // per-consumer predicate enforces the stricter split-text rule.
  if (direction === "target" && handleId === "text") {
    const direct: NodeOption[] = []
    const compatible: NodeOption[] = []
    const directTypes = new Set<SceneNodeType>()
    for (const option of nodeOptions) {
      if (TEXT_PRODUCER_TYPES.has(option.type)) {
        direct.push(option)
        directTypes.add(option.type)
      } else if (VISUAL_PARAMETER_PICKER_NODE_TYPES.has(option.type)) {
        compatible.push(option)
      }
    }
    return { direct, compatible, directTypes }
  }

  // `video` (Batch 4: split-media's video input) accepts video producers
  // only. (merge-video-audio's video slot is owned by ffmpeg-handles.ts.)
  if (direction === "target" && handleId === "video") {
    const direct: NodeOption[] = []
    const directTypes = new Set<SceneNodeType>()
    for (const option of nodeOptions) {
      if (!VIDEO_PRODUCER_TYPES.has(option.type)) continue
      direct.push(option)
      directTypes.add(option.type)
    }
    return { direct, compatible: [], directTypes }
  }

  // `audio1` + `audio2` (suno-mashup) accept audio producers only.
  if (direction === "target" && (handleId === "audio1" || handleId === "audio2")) {
    const direct: NodeOption[] = []
    const directTypes = new Set<SceneNodeType>()
    for (const option of nodeOptions) {
      if (!AUDIO_PRODUCER_TYPES.has(option.type)) continue
      direct.push(option)
      directTypes.add(option.type)
    }
    return { direct, compatible: [], directTypes }
  }

  // `system-prompt` (llm-chat) accepts text producers only. Pickers are
  // excluded — system messages are full-prompt context, not value
  // substitution. Mirrors the canvas validator's branch.
  if (direction === "target" && handleId === "system-prompt") {
    const direct: NodeOption[] = []
    const directTypes = new Set<SceneNodeType>()
    for (const option of nodeOptions) {
      if (!TEXT_PRODUCER_TYPES.has(option.type)) continue
      direct.push(option)
      directTypes.add(option.type)
    }
    return { direct, compatible: [], directTypes }
  }

  // `transcript` (forced-alignment) accepts text producers only.
  if (direction === "target" && handleId === "transcript") {
    const direct: NodeOption[] = []
    const directTypes = new Set<SceneNodeType>()
    for (const option of nodeOptions) {
      if (!TEXT_PRODUCER_TYPES.has(option.type)) continue
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
    // List nodes use "col_add" quick-add. The col_add handler in
    // use-workflow-store auto-detects the column type from the source AND
    // sets column[0].connectedSourceId / type / name. Routing to the
    // static "in" pip instead would leave column metadata unset, which
    // breaks clearConnectedListRows (run-handlers.ts) on subsequent runs
    // and confuses any later col_add drop (soleEmptyCol check would still
    // see col[0] as empty and clobber it). The popover Connect button
    // still wires to "in" directly (via TARGET_HANDLE_ACCEPTS) — that
    // path is the passthrough flow and doesn't need column metadata.
    if (nodeType === "list") return "col_add"
    return def.inputs.find((h) => compatible.includes(h)) ?? "in"
  } else {
    return def.outputs.find((h) => compatible.includes(h)) ?? def.outputs[0] ?? "out"
  }
}
