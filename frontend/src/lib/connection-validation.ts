import { isValidGenerateImageConnection } from "./generate-image-handles"
import { isValidGenerateVideoConnection } from "./generate-video-handles"
import { isValidGenerateVideoProConnection } from "./generate-video-pro-handles"
import { isValidVideoRetakeConnection, type VideoRetakeHandleId } from "./video-retake-handles"
import { isValidVideoSfxConnection } from "./video-sfx-handles"
import { FFMPEG_NODE_TYPES, isValidFfmpegConnection, ACCEPTS_VIDEO, ACCEPTS_AUDIO } from "./ffmpeg-handles"
import {
  isValidTextToSpeechConnection,
  isValidTextToAudioConnection,
  isValidGenerateMusicConnection,
  isValidAudioIsolationConnection,
  isValidAudioSeparationConnection,
  isValidTextToDialogueConnection,
  isValidVoiceChangerConnection,
  isValidDubbingConnection,
  isValidVoiceRemixConnection,
  isValidVoiceDesignConnection,
  isValidForcedAlignmentConnection,
  isValidSunoGenerateConnection,
  isValidSunoCoverConnection,
  isValidSunoExtendConnection,
  isValidSunoLyricsConnection,
  isValidSunoSeparateConnection,
  isValidSunoMusicVideoConnection,
  isValidSunoMashupConnection,
  isValidSunoReplaceSectionConnection,
  isValidSunoStyleBoostConnection,
  isValidSunoAddInstrumentalConnection,
  isValidSunoAddVocalsConnection,
  isValidSunoConvertWavConnection,
  isValidSunoUploadExtendConnection,
  isValidGenerateScriptConnection,
  isValidLlmChatConnection,
  isValidTranscribeConnection,
  isValidSplitMediaConnection,
  isValidCombineTextConnection,
  isValidSplitTextConnection,
  isValidPreviewConnection,
} from "./audio-text-handles"
import {
  isValidListNodeConnection,
  isValidWebScrapeConnection,
  isValidExtractFieldConnection,
  isValidFilterListConnection,
  isValidDeduplicateConnection,
  isValidMergeListsConnection,
  isValidSortListConnection,
  isValidSelectorConnection,
  isValidLoopCoarse,
} from "./data-handles"
import {
  isValidEditImageConnection,
  isValidModifyImageConnection,
  isValidImageToImageConnection,
  isValidGenerateMaskConnection,
  isValidImageCollageConnection,
  isValidUpscaleImageConnection,
  isValidRemoveBackgroundConnection,
  isValidFaceSwapConnection,
  isValidImageToTextConnection,
} from "./image-producer-handles"
import {
  isValidVideoToVideoConnection,
  isValidVideoUpscaleConnection,
  isValidExtendVideoConnection,
  isValidLipSyncConnection,
  isValidSpeechToVideoConnection,
  isValidMotionTransferConnection,
  isValidAiAvatarConnection,
  isValidCinematicAvatarConnection,
  isValidSwitchXConnection,
} from "./video-producer-handles"
import {
  isValidCharacterConnection,
  isValidFaceConnection,
  isValidObjectConnection,
  isValidCreatureConnection,
  isValidLocationConnection,
} from "./identity-handles"
import { isAnalyzablePicker } from "@nodaro/prompts"
import { resolveEffectiveSourceType, ENTITY_IMAGE_HANDLE_TYPES } from "@nodaro/shared"
import { isVisualPickerType } from "./parameter-picker-types"
import { ACCEPTS_CHARACTER_REF, ACCEPTS_ENTITY_REF, ACCEPTS_LOTTIE_ASSET, ACCEPTS_PARAMETER_PICKER, ACCEPTS_PICKER_JSON } from "./target-handle-registry"

const MEDIA_ONLY_HANDLES: ReadonlySet<string> = new Set([
  "image",
  "video",
  "audio",
  "startFrame",
  "endFrame",
  "video1",
  "video2",
  "video3",
  "video4",
  "audio1",
  "audio2",
  "audio3",
  "audio4",
  "audio5",
  "ref-audio",
])

// Re-exported from @nodaro/shared so the connection surfaces, run assemblers,
// preview builders, and backend all consult ONE definition. Existing importers
// of `@/lib/connection-validation` (handle-popover, handle-with-popover, tests)
// are unaffected.
export { resolveEffectiveSourceType, ENTITY_IMAGE_HANDLE_TYPES }

/**
 * The SOURCE handle ids a node can be wired FROM, for reverse (target-
 * direction) candidate enumeration. Entity nodes render an `image` passthrough
 * source handle that is intentionally NOT declared in `NODE_DEFINITIONS.outputs`
 * — their declared output is the `*Ref` identity handle, which drives execution
 * and ref resolution. We surface the `image` handle HERE so an image input's
 * popover can offer the entity wired to its plain-image output. Sourced from the
 * SAME `ENTITY_IMAGE_HANDLE_TYPES` set as `resolveEffectiveSourceType`, so the
 * two can't drift; non-entity nodes get their declared outputs verbatim.
 */
export function enumerableSourceHandles(
  nodeType: string,
  declaredOutputs: readonly string[],
): string[] {
  if (ENTITY_IMAGE_HANDLE_TYPES.has(nodeType) && !declaredOutputs.includes("image")) {
    return [...declaredOutputs, "image"]
  }
  return [...declaredOutputs]
}

export interface ConnectionShape {
  readonly source?: string | null
  readonly target?: string | null
  readonly sourceHandle?: string | null
  readonly targetHandle?: string | null
}

export interface EdgeShape {
  readonly source: string
  readonly target: string
}

/**
 * Adjacency index: source-id → list of target-ids. Build once per
 * connection-validation pass (memoize on the edges array) and reuse across
 * every probe — the alternative, rescanning all edges per probe, is
 * O(N×E) and gets very slow on large flows during drag-to-connect (React
 * Flow probes isValidConnection on every cursor move).
 */
export type AdjacencyIndex = ReadonlyMap<string, readonly string[]>

export function buildAdjacency(edges: readonly EdgeShape[]): AdjacencyIndex {
  const adj = new Map<string, string[]>()
  for (const e of edges) {
    const arr = adj.get(e.source)
    if (arr) arr.push(e.target)
    else adj.set(e.source, [e.target])
  }
  return adj
}

/**
 * Pure validity check for a workflow connection. Mirrors the rules enforced
 * by `<ReactFlow isValidConnection>` in `workflow-canvas.tsx` so any code path
 * that creates edges outside of drag-to-connect (e.g., HandlePopover's
 * Connect button) can reuse the SAME rules without duplicating logic.
 *
 * Pass `getNodeType(id)` so the helper stays decoupled from React Flow's
 * `getNode` API — call sites either reach into the store or the React Flow
 * instance and project to just the type string.
 *
 * Pass `graph` (a precomputed `AdjacencyIndex`) to enable acyclic-DAG
 * enforcement (rejects self-loops and connections whose target already has
 * a downstream path to the source). Optional so call sites without the
 * edge list still get type-validation; every UI surface should pass it.
 */
export function isValidWorkflowConnection(
  connection: ConnectionShape,
  getNodeType: (id: string) => string | undefined,
  graph?: AdjacencyIndex,
): boolean {
  // Helper to resolve a connection endpoint to its node type. Uses the
  // ternary form (not `?? ""`) so we don't do a Map lookup with an empty-
  // string key — both spellings yield the same answer today, but the
  // ternary makes the intent explicit and matches the pattern used below.
  const typeOf = (id: string | null | undefined): string | undefined =>
    id ? getNodeType(id) : undefined

  // Reject self-loops outright (cycle of length 1). Also covers the case
  // where the user drags an output handle back to a different input on the
  // same node — the workflow engine is a DAG and cannot execute a node
  // before itself.
  if (connection.source && connection.target && connection.source === connection.target) {
    return false
  }

  // Reject any connection that would close a directed cycle. Starting from
  // the prospective target, DFS downstream along existing edges — if we
  // reach the prospective source, adding source→target closes a cycle.
  if (graph && connection.source && connection.target) {
    if (wouldCreateCycle(graph, connection.source, connection.target)) {
      return false
    }
  }

  // Composition output may ONLY target render-video. (Same rule as in
  // workflow-canvas.tsx::isValidConnection.)
  if (connection.sourceHandle === "composition") {
    return typeOf(connection.target) === "render-video"
  }

  // motion-graphics `lottie` source (the authored Lottie JSON URL, lottie
  // engine only) may ONLY feed a lottie-overlay `lottie` target — that is the
  // single consumer of authored-animation assets. Symmetric to the
  // `composition` rule above; keeps the source pip from lighting up arbitrary
  // targets during a drag.
  if (connection.sourceHandle === "lottie") {
    return typeOf(connection.target) === "lottie-overlay" && connection.targetHandle === "lottie"
  }

  // describe-to-picker `picker-json` source (catalog-valid picker JSON from a
  // vision-LLM image analysis) may ONLY feed an analyzable picker's
  // `picker-json` target — the consumers that apply the JSON to their fields.
  // Set-driven via `isAnalyzablePicker` (@nodaro/shared) so registering a new
  // analyzable picker auto-extends this rule. Symmetric to the `composition` /
  // `lottie` source rules above; keeps the source pip from lighting up
  // arbitrary targets during a drag.
  if (connection.sourceHandle === "picker-json") {
    return isAnalyzablePicker(typeOf(connection.target) ?? "") && connection.targetHandle === "picker-json"
  }

  // JSON output cannot feed media-only inputs.
  if (connection.sourceHandle === "json") {
    const th = connection.targetHandle ?? ""
    if (MEDIA_ONLY_HANDLES.has(th)) return false
  }

  // Generate Image v2.1 — enforce typed-handle compatibility.
  const targetType = typeOf(connection.target)

  // PR #3369 + Phase 1 (entity-studios-parity §3): every entity node
  // (character / location / object / creature) exposes a plain `image` source
  // handle alongside its identity `*Ref` handle, behaving as a plain image
  // PRODUCER there (valid into image inputs: generate-image `references`,
  // image-to-image, lip-sync image, etc.) and NOT as an identity ref.
  // `resolveEffectiveSourceType` is the single source of truth for that remap;
  // the drag-glow + source-direction popover call it too, so the visual
  // "possible connections" can't drift from this drop rule. For every other
  // source it returns the raw type, so existing connections are unaffected.
  const rawSourceType = typeOf(connection.source)
  const imageSourceType = resolveEffectiveSourceType(rawSourceType, connection.sourceHandle)

  if (targetType === "generate-image" && connection.targetHandle) {
    return isValidGenerateImageConnection(
      connection.targetHandle,
      imageSourceType,
      isVisualPickerType,
    )
  }

  // Camera Motion — startState/endState only accept hint-producer nodes
  // (their wires carry prompt fragments, not image frames; see
  // packages/shared/src/parameter-prompt-hint.ts:195-307). Other handles
  // (legacy/external) are not validated here.
  if (targetType === "camera-motion" && connection.targetHandle) {
    if (connection.targetHandle !== "startState" && connection.targetHandle !== "endState") {
      return true
    }
    // `?? ""` so unknown / undefined source types route to the predicate's
    // negative branch instead of falling through to default `return true`.
    return ACCEPTS_PARAMETER_PICKER(typeOf(connection.source) ?? "")
  }

  // Transition — same semantics as camera-motion. startState/endState wires
  // carry prompt hints, not image frames; see
  // packages/shared/src/parameter-prompt-hint.ts:150-176.
  if (targetType === "transition" && connection.targetHandle) {
    if (connection.targetHandle !== "startState" && connection.targetHandle !== "endState") {
      return true
    }
    return ACCEPTS_PARAMETER_PICKER(typeOf(connection.source) ?? "")
  }

  // Character-fx — `target` accepts ONLY identity refs (character/face/
  // object/location). The shared hint-builder reads `characterName` etc.
  // from the source; see packages/shared/src/parameter-prompt-hint.ts:178-202.
  if (targetType === "character-fx" && connection.targetHandle) {
    if (connection.targetHandle !== "target") return true
    return ACCEPTS_CHARACTER_REF(typeOf(connection.source) ?? "")
  }

  // Any analyzable picker's `picker-json` target accepts ONLY the
  // describe-to-picker producer (catalog-valid picker JSON). Set-driven via
  // `isAnalyzablePicker` (@nodaro/shared). Scoped to the `picker-json` handle
  // ONLY — the pickers' other handles (e.g. the default `in`) deliberately
  // fall through to their own rules / the default-allow below. (Person has
  // only a `picker-json` input, so there is nothing to fall through for it.)
  // Mirrors the source-side `picker-json` rule above so the canvas validator
  // and the target pip's accepts predicate agree.
  if (isAnalyzablePicker(targetType ?? "") && connection.targetHandle === "picker-json") {
    return ACCEPTS_PICKER_JSON(typeOf(connection.source) ?? "")
  }

  // Reference Sheet — `in` accepts ONLY composable entity refs (character /
  // object / location; NOT face). The executor resolves the upstream entity's
  // (kind, DB id) and composes a sheet from its existing panels.
  if (targetType === "reference-sheet" && connection.targetHandle) {
    if (connection.targetHandle !== "in") return true
    return ACCEPTS_ENTITY_REF(typeOf(connection.source) ?? "")
  }

  // Generate Video — enforce typed-handle compatibility.
  if (targetType === "generate-video" && connection.targetHandle) {
    if (imageSourceType) {
      return isValidGenerateVideoConnection(
        connection.targetHandle,
        imageSourceType,
        isVisualPickerType,
      )
    }
  }

  // Generate Video Pro — trimmed sibling of Generate Video (prompt/startFrame/
  // imageReferences only). Uses imageSourceType (not raw typeOf) like
  // generate-video above, since startFrame/imageReferences need the entity
  // "image" source-handle remap that AUDIO_TEXT_VALIDATORS doesn't apply.
  if (targetType === "generate-video-pro" && connection.targetHandle) {
    if (imageSourceType) {
      return isValidGenerateVideoProConnection(
        connection.targetHandle,
        imageSourceType,
        isVisualPickerType,
      )
    }
  }

  // Video Retake — enforce typed-handle compatibility.
  if (targetType === "video-retake" && connection.targetHandle) {
    const handleId = connection.targetHandle as VideoRetakeHandleId | null
    if (!handleId) return false
    const sourceType = typeOf(connection.source) ?? ""
    return isValidVideoRetakeConnection(handleId, sourceType, isVisualPickerType)
  }

  // Video SFX — enforce typed-handle compatibility. Mirrors generate-video
  // wiring but uses the narrower predicate from video-sfx-handles.ts:
  // prompt/negative accept text producers OR pickers; video accepts video
  // producers; unknown handles return false.
  if (targetType === "video-sfx" && connection.targetHandle) {
    const sourceType = typeOf(connection.source)
    return isValidVideoSfxConnection(
      connection.targetHandle,
      sourceType ?? "",
      isVisualPickerType,
    )
  }

  // Image-producer nodes (edit-image, modify-image, image-to-image,
  // generate-mask, upscale-image, remove-background, face-swap,
  // image-to-text) — each owns its target-handle predicate, dispatched
  // here so connection-validation and HandlePopover share one rule set.
  if (connection.targetHandle) {
    const validator = IMAGE_PRODUCER_VALIDATORS[targetType ?? ""]
    if (validator) {
      return validator(
        connection.targetHandle,
        imageSourceType,
        isVisualPickerType,
      )
    }
  }

  // Video-producer nodes (video-to-video, video-upscale, extend-video,
  // lip-sync, speech-to-video, motion-transfer) — Phase 21.
  if (connection.targetHandle) {
    const validator = VIDEO_PRODUCER_VALIDATORS[targetType ?? ""]
    if (validator) {
      return validator(
        connection.targetHandle,
        imageSourceType,
        isVisualPickerType,
      )
    }
  }

  // Identity nodes (character, face, object, creature, location) — Phase 23.
  // Each has a `in` text-prompt input; object + creature add a `type` picker
  // target and location adds a `cinematography` picker target.
  if (connection.targetHandle) {
    const validator = IDENTITY_VALIDATORS[targetType ?? ""]
    if (validator) {
      return validator(
        connection.targetHandle,
        typeOf(connection.source) ?? "",
        isVisualPickerType,
      )
    }
  }

  // FFmpeg / pure-processing nodes (trim-video, combine-videos,
  // merge-video-audio, extract-frame, loop-video, resize-video,
  // add-captions, trim-audio, adjust-volume, combine-audio, mix-audio).
  // Shared validator in `ffmpeg-handles.ts` — all 11 nodes route through
  // a single switch so the type rules stay co-located. `?? ""` so unknown
  // / undefined source types route to the predicate's negative branch
  // instead of falling through to default `return true`.
  if (targetType && FFMPEG_NODE_TYPES.has(targetType) && connection.targetHandle) {
    return isValidFfmpegConnection(
      targetType,
      connection.targetHandle,
      typeOf(connection.source) ?? "",
    )
  }

  // Assemble Narrated Video — two DISTINCT typed handles (video clips list,
  // voice audio list), unlike the ffmpeg family above which shares one `in`
  // handle per node. Mirrors the accepts predicates registered in
  // target-handle-registry.ts so drag-to-connect, the Connect button, and
  // the source-direction popover all agree.
  if (targetType === "assemble-narrated-video" && connection.targetHandle) {
    const sourceType = typeOf(connection.source) ?? ""
    if (connection.targetHandle === "video") return ACCEPTS_VIDEO(sourceType)
    if (connection.targetHandle === "audio") return ACCEPTS_AUDIO(sourceType)
    return false
  }

  // ─── Data root-category nodes ─────────────────────────────────────────
  // Each predicate covers one node's full set of typed input handles. The
  // loop-node case uses a coarse gate (any-column-type producer) because
  // the per-column accepts depend on the column's type stored in node
  // data — unreachable from `getNodeType`. Per-column refinement happens
  // in `loop-node.tsx`'s per-pip `accepts` predicate (which drives the
  // drag-glow visual and popover candidate filtering).
  if (targetType === "list" && connection.targetHandle) {
    // "list" SceneNodeType renders via LoopNode (nodes/index.ts:166), which
    // uses per-column target handles (`col_xxx_in`) — not the bare `"in"`
    // that isValidListNodeConnection's switch checks. Without the coarse
    // gate, every column-handle drop falls through to `return false` and
    // any text-prompt → list connection gets rejected at drag time.
    if (connection.targetHandle === "in") {
      return isValidListNodeConnection(
        connection.targetHandle,
        imageSourceType,
        isVisualPickerType,
      )
    }
    return isValidLoopCoarse(imageSourceType, isVisualPickerType)
  }
  if (targetType === "web-scrape" && connection.targetHandle) {
    return isValidWebScrapeConnection(
      connection.targetHandle,
      typeOf(connection.source) ?? "",
    )
  }
  // Video Analysis — single `video` target accepts video producers. Inline
  // ACCEPTS_VIDEO (same predicate the handle popover uses) so drag-to-connect
  // and the source-direction popover agree.
  if (targetType === "video-analysis" && connection.targetHandle === "video") {
    return ACCEPTS_VIDEO(typeOf(connection.source) ?? "")
  }
  if (targetType === "extract-field" && connection.targetHandle) {
    return isValidExtractFieldConnection(
      connection.targetHandle,
      typeOf(connection.source) ?? "",
    )
  }
  if (targetType === "filter-list" && connection.targetHandle) {
    return isValidFilterListConnection(
      connection.targetHandle,
      typeOf(connection.source) ?? "",
      isVisualPickerType,
    )
  }
  if (targetType === "deduplicate" && connection.targetHandle) {
    return isValidDeduplicateConnection(
      connection.targetHandle,
      typeOf(connection.source) ?? "",
    )
  }
  if (targetType === "merge-lists" && connection.targetHandle) {
    return isValidMergeListsConnection(
      connection.targetHandle,
      typeOf(connection.source) ?? "",
    )
  }
  if (targetType === "sort-list" && connection.targetHandle) {
    return isValidSortListConnection(
      connection.targetHandle,
      typeOf(connection.source) ?? "",
    )
  }
  if (targetType === "selector" && connection.targetHandle) {
    return isValidSelectorConnection(
      connection.targetHandle,
      typeOf(connection.source) ?? "",
      isVisualPickerType,
    )
  }

  // Lottie Overlay — `lottie` target accepts the authored-animation producers
  // (motion-graphics lottie engine + upload nodes that pass a URL); `video`
  // accepts video producers. Keeps the canvas validator and the source-pip
  // glow in agreement with the source-handle rule above (motion-graphics
  // `lottie` → lottie-overlay `lottie`). Other handles are not validated here.
  if (targetType === "lottie-overlay" && connection.targetHandle === "lottie") {
    return ACCEPTS_LOTTIE_ASSET(typeOf(connection.source) ?? "")
  }

  // Audio & Speech, Suno Music, Script & Text, and Processing (Audio + Text)
  // — 31 nodes covered by audio-text-handles.ts predicates. The dispatch
  // table keeps this list flat: adding a new node here means one tuple
  // entry instead of another `if (targetType === "...") { ... }` branch.
  // Predicates own their per-handle switch.
  //
  // NOTE: the 5 ffmpeg-overlapping nodes (merge-video-audio, trim-audio,
  // mix-audio, combine-audio, adjust-volume) are NOT in this table — they
  // already route through `isValidFfmpegConnection` above (shipped in #2809).
  if (connection.targetHandle) {
    const validator = AUDIO_TEXT_VALIDATORS[targetType ?? ""]
    if (validator) {
      const sourceType = typeOf(connection.source) ?? ""
      return validator(connection.targetHandle, sourceType, isVisualPickerType)
    }
  }

  return true
}

type AudioTextValidator = (
  targetHandleId: string,
  sourceType: string,
  isVisualPicker: (t: string) => boolean,
) => boolean

const IMAGE_PRODUCER_VALIDATORS: Record<string, AudioTextValidator> = {
  "edit-image":        isValidEditImageConnection,
  "modify-image":      isValidModifyImageConnection,
  "image-to-image":    isValidImageToImageConnection,
  "generate-mask":     (h, s) => isValidGenerateMaskConnection(h, s),
  "image-collage":     (h, s) => isValidImageCollageConnection(h, s),
  "upscale-image":     (h, s) => isValidUpscaleImageConnection(h, s),
  "remove-background": (h, s) => isValidRemoveBackgroundConnection(h, s),
  "face-swap":         (h, s) => isValidFaceSwapConnection(h, s),
  "image-to-text":     (h, s) => isValidImageToTextConnection(h, s),
  // describe-to-picker has a single `image` target input; reuse the
  // image-to-text predicate (image OR video producers accepted, the
  // producer only consumes the image handle).
  "describe-to-picker": (h, s) => isValidImageToTextConnection(h, s),
}

const VIDEO_PRODUCER_VALIDATORS: Record<string, AudioTextValidator> = {
  "video-to-video":   isValidVideoToVideoConnection,
  "video-upscale":    (h, s) => isValidVideoUpscaleConnection(h, s),
  "extend-video":     isValidExtendVideoConnection,
  "lip-sync":         (h, s) => isValidLipSyncConnection(h, s),
  "speech-to-video":  isValidSpeechToVideoConnection,
  "motion-transfer":  (h, s) => isValidMotionTransferConnection(h, s),
  "ai-avatar":        isValidAiAvatarConnection,
  "cinematic-avatar": isValidCinematicAvatarConnection,
  "switchx":          isValidSwitchXConnection,
}

const IDENTITY_VALIDATORS: Record<string, AudioTextValidator> = {
  "character": isValidCharacterConnection,
  "face":      isValidFaceConnection,
  "object":    isValidObjectConnection,
  "creature":  isValidCreatureConnection,
  "location":  isValidLocationConnection,
}

const AUDIO_TEXT_VALIDATORS: Record<string, AudioTextValidator> = {
  // Batch 1: AI > Audio & Speech
  "text-to-speech":    isValidTextToSpeechConnection,
  "text-to-audio":     isValidTextToAudioConnection,
  "generate-music":    isValidGenerateMusicConnection,
  // Predicates that don't take isVisualPicker get a thin adapter so the
  // dispatch table is homogeneous (Record<string, AudioTextValidator>).
  "audio-isolation":   (h, s) => isValidAudioIsolationConnection(h, s),
  "audio-separation":  (h, s) => isValidAudioSeparationConnection(h, s),
  "text-to-dialogue":  isValidTextToDialogueConnection,
  "voice-changer":     (h, s) => isValidVoiceChangerConnection(h, s),
  "voice-changer-pro":      (h, s) => isValidVoiceChangerConnection(h, s),
  "dubbing":           (h, s) => isValidDubbingConnection(h, s),
  "voice-remix":       (h, s) => isValidVoiceRemixConnection(h, s),
  "voice-design":      isValidVoiceDesignConnection,
  "forced-alignment":  (h, s) => isValidForcedAlignmentConnection(h, s),
  // Batch 2: AI > Suno Music
  "suno-generate":         isValidSunoGenerateConnection,
  "suno-cover":            isValidSunoCoverConnection,
  "suno-extend":           isValidSunoExtendConnection,
  "suno-lyrics":           isValidSunoLyricsConnection,
  "suno-separate":         (h, s) => isValidSunoSeparateConnection(h, s),
  "suno-music-video":      (h, s) => isValidSunoMusicVideoConnection(h, s),
  "suno-mashup":           (h, s) => isValidSunoMashupConnection(h, s),
  "suno-replace-section":  isValidSunoReplaceSectionConnection,
  "suno-style-boost":      isValidSunoStyleBoostConnection,
  "suno-add-instrumental": (h, s) => isValidSunoAddInstrumentalConnection(h, s),
  "suno-add-vocals":       (h, s) => isValidSunoAddVocalsConnection(h, s),
  "suno-convert-wav":      (h, s) => isValidSunoConvertWavConnection(h, s),
  "suno-upload-extend":    isValidSunoUploadExtendConnection,
  // Batch 3: AI > Script & Text
  "generate-script": isValidGenerateScriptConnection,
  "llm-chat":        isValidLlmChatConnection,
  "transcribe":      (h, s) => isValidTranscribeConnection(h, s),
  // Batch 4: Processing > Audio + Text (only non-ffmpeg-overlapping ones)
  "split-media":     (h, s) => isValidSplitMediaConnection(h, s),
  "combine-text":    isValidCombineTextConnection,
  "split-text":      (h, s) => isValidSplitTextConnection(h, s),
  "preview":         (h) => isValidPreviewConnection(h),
}

/**
 * DFS downstream from `newTarget` along the adjacency index. Returns true
 * iff we can reach `newSource` — meaning a path `newTarget → … → newSource`
 * already exists, and adding `newSource → newTarget` would close a cycle.
 *
 * DFS over BFS: `stack.pop()` is O(1) where `Array.prototype.shift()` is
 * O(n) on a growing queue — a big deal on dense flows. Reachability is
 * direction-agnostic, so DFS is equally correct here.
 *
 * Uses a visited set so dense graphs don't re-explore subtrees. Early-exits
 * the moment `newSource` is hit (typical case: small bounce on a sink).
 */
function wouldCreateCycle(
  adj: AdjacencyIndex,
  newSource: string,
  newTarget: string,
): boolean {
  const visited = new Set<string>()
  const stack: string[] = [newTarget]
  while (stack.length > 0) {
    const current = stack.pop()!
    if (current === newSource) return true
    if (visited.has(current)) continue
    visited.add(current)
    const outs = adj.get(current)
    if (outs) {
      for (const t of outs) {
        if (!visited.has(t)) stack.push(t)
      }
    }
  }
  return false
}

/**
 * Returns the set of nodes reachable downstream from `root` (inclusive).
 * Run ONCE per consumer in callers that probe many candidate sources —
 * any candidate whose id is in this set would create a cycle if used as
 * the source of an edge into `root`, so candidate filtering collapses
 * from O(N × cycle-BFS) to O(1) membership tests after a single O(V+E)
 * traversal.
 */
export function collectDescendants(
  adj: AdjacencyIndex,
  root: string,
): ReadonlySet<string> {
  const visited = new Set<string>()
  const stack: string[] = [root]
  while (stack.length > 0) {
    const current = stack.pop()!
    if (visited.has(current)) continue
    visited.add(current)
    const outs = adj.get(current)
    if (outs) {
      for (const t of outs) {
        if (!visited.has(t)) stack.push(t)
      }
    }
  }
  return visited
}

/**
 * Reverse adjacency: target-id → list of source-ids. Together with
 * `collectDescendants` this gives ancestor traversal — pass the reverse
 * adjacency as the `adj` arg and the function walks UPSTREAM.
 *
 * Same one-pass build complexity as `buildAdjacency` (O(E)), so building
 * both forward + reverse off a single edges array is still O(E) total.
 */
export function buildReverseAdjacency(edges: readonly EdgeShape[]): AdjacencyIndex {
  const adj = new Map<string, string[]>()
  for (const e of edges) {
    const arr = adj.get(e.target)
    if (arr) arr.push(e.source)
    else adj.set(e.target, [e.source])
  }
  return adj
}

/**
 * Single-entry memo of `collectDescendants(buildReverseAdjacency(edges), fromNodeId)`
 * — the set of nodes that can reach `fromNodeId` upstream, i.e. the
 * ancestors of `fromNodeId` (inclusive of itself).
 *
 * Why a module-level cache: during a drag-to-connect, every visible
 * HandleWithPopover re-derives `isValidCandidate` and needs to ask
 * "would my node create a cycle if I accept this drag?" The answer
 * depends only on (edges ref, drag-source nodeId) — both stable for the
 * duration of one drag. Without the cache, each handle (often dozens
 * per visible viewport) would rebuild the same reverse adjacency + run
 * the same DFS, O(V+E) per handle. With the cache, exactly one of them
 * pays that cost; the rest hit the cache.
 *
 * Cache invalidates on any change to `edges` reference or `fromNodeId`,
 * which matches every drag start/end and every edge mutation.
 */
let cachedAncestorsEdges: readonly EdgeShape[] | null = null
let cachedAncestorsFromId: string | null = null
let cachedAncestorsResult: ReadonlySet<string> | null = null

export function getDragAncestorSet(
  edges: readonly EdgeShape[],
  fromNodeId: string,
): ReadonlySet<string> {
  if (
    edges === cachedAncestorsEdges &&
    fromNodeId === cachedAncestorsFromId &&
    cachedAncestorsResult !== null
  ) {
    return cachedAncestorsResult
  }
  const result = collectDescendants(buildReverseAdjacency(edges), fromNodeId)
  cachedAncestorsEdges = edges
  cachedAncestorsFromId = fromNodeId
  cachedAncestorsResult = result
  return result
}

export interface TargetCandidate {
  readonly nodeId: string
  readonly nodeType: string
  readonly sourceHandle: string
}

export interface CollectTargetCandidatesParams {
  readonly nodes: ReadonlyArray<{ readonly id: string; readonly type?: string }>
  readonly edges: readonly EdgeShape[]
  /** The consumer (input) node whose handle the popover was opened on. */
  readonly consumerId: string
  readonly consumerHandleId: string
  /** Source-node ids already wired to (consumerId, consumerHandleId) — skipped. */
  readonly alreadyConnectedIds: ReadonlySet<string>
  /** The input handle's predicate, called with a producer's EFFECTIVE output type. */
  readonly accepts: (effectiveSourceType: string) => boolean
  readonly nodeTypeById: (id: string) => string | undefined
  /** Declared output handles for a node type (`NODE_DEFINITIONS.outputs`), or
   *  undefined when the type has no descriptor. */
  readonly outputsOf: (nodeType: string) => readonly string[] | undefined
}

/**
 * Enumerate producer candidates for a target (input) handle's popover — the
 * upstream nodes that can be wired INTO (consumerId, consumerHandleId).
 *
 * For each in-graph node (newest first), pick the FIRST of its source handles
 * (`enumerableSourceHandles`) whose effective output type the input `accepts`
 * AND that passes the global validator, and emit a candidate wired to that
 * handle. "First match wins" keeps single-output nodes identical to the legacy
 * `outputs[0]` behavior, while letting an entity resolve to its `image` handle
 * for image inputs and its `*Ref` handle for identity inputs.
 *
 * `hasDynamicOutputCandidates` flags accepted dynamic-output nodes (list/loop)
 * that have no static handle to wire — the popover shows a "drag for column
 * outputs" hint instead of a row, matching the legacy gate (accepted type +
 * empty declared outputs).
 */
export function collectTargetCandidates(
  params: CollectTargetCandidatesParams,
): { candidates: TargetCandidate[]; hasDynamicOutputCandidates: boolean } {
  const {
    nodes,
    edges,
    consumerId,
    consumerHandleId,
    alreadyConnectedIds,
    accepts,
    nodeTypeById,
    outputsOf,
  } = params
  // Any node already downstream of the consumer would close a cycle if wired as
  // a new source into it — filter them all with one O(V+E) descendant pass.
  const cycleInducingIds = collectDescendants(buildAdjacency(edges), consumerId)
  const candidates: TargetCandidate[] = []
  let hasDynamicOutputCandidates = false
  // Reverse iteration: newest nodes (appended last) surface first.
  for (let i = nodes.length - 1; i >= 0; i--) {
    const n = nodes[i]
    if (n.id === consumerId) continue // skip the consumer itself
    if (alreadyConnectedIds.has(n.id)) continue // already wired on this handle
    if (cycleInducingIds.has(n.id)) continue // would create a cycle
    const t = n.type ?? ""
    if (!t) continue
    const declared = outputsOf(t)
    if (declared === undefined) continue // unknown type / no descriptor
    const handles = enumerableSourceHandles(t, declared)
    if (handles.length === 0) {
      // Dynamic-output node (list/loop): no static handle to wire. Flag it
      // exactly where the legacy code did — when its node type is accepted.
      if (accepts(t)) hasDynamicOutputCandidates = true
      continue
    }
    let chosen: string | undefined
    for (const handle of handles) {
      if (!accepts(resolveEffectiveSourceType(t, handle))) continue
      // Global rules (json→media, composition→render-video, …). Cycle filtering
      // already happened above, so the graph arg is omitted.
      if (
        !isValidWorkflowConnection(
          { source: n.id, sourceHandle: handle, target: consumerId, targetHandle: consumerHandleId },
          nodeTypeById,
        )
      ) {
        continue
      }
      chosen = handle
      break
    }
    if (!chosen) continue
    candidates.push({ nodeId: n.id, nodeType: t, sourceHandle: chosen })
  }
  return { candidates, hasDynamicOutputCandidates }
}
