import { GENERATE_IMAGE_INPUT_HANDLES, IDENTITY_TYPES, isValidGenerateImageConnection } from "./generate-image-handles"
import { ACCEPTS_VIDEO, ACCEPTS_AUDIO, ACCEPTS_MEDIA } from "./ffmpeg-handles"
import {
  isValidListNodeConnection,
  isValidWebScrapeConnection,
  isValidExtractFieldConnection,
  isValidFilterListConnection,
  isValidDeduplicateConnection,
  isValidMergeListsConnection,
  isValidSortListConnection,
  isValidSelectorConnection,
  isDataProducer,
} from "./data-handles"
import { VISUAL_PARAMETER_PICKER_NODE_TYPES, isVisualPickerType } from "./parameter-picker-types"
import {
  IMAGE_PRODUCER_HANDLE_LABELS,
  isValidEditImageConnection,
  isValidModifyImageConnection,
  isValidImageToImageConnection,
  isValidGenerateMaskConnection,
  isValidUpscaleImageConnection,
  isValidRemoveBackgroundConnection,
  isValidFaceSwapConnection,
  isValidImageToTextConnection,
} from "./image-producer-handles"
import {
  VIDEO_PRODUCER_HANDLE_LABELS,
  isValidVideoToVideoConnection,
  isValidVideoUpscaleConnection,
  isValidExtendVideoConnection,
  isValidLipSyncConnection,
  isValidSpeechToVideoConnection,
  isValidMotionTransferConnection,
  isValidAiAvatarConnection,
  isValidCinematicAvatarConnection,
} from "./video-producer-handles"
import {
  IDENTITY_HANDLE_LABELS,
  isValidCharacterConnection,
  isValidFaceConnection,
  isValidObjectConnection,
  isValidLocationConnection,
} from "./identity-handles"
import {
  AUDIO_TEXT_HANDLE_LABELS,
  isValidTextToSpeechConnection,
  isValidTextToAudioConnection,
  isValidGenerateMusicConnection,
  isValidAudioIsolationConnection,
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

export interface TargetHandleEntry {
  readonly handleId: string
  /** Human-readable label for the candidate-row chip in source-direction
   *  popovers (e.g. "Start state", "Look"). Falls back to raw handleId in
   *  the UI when omitted. Kept optional so additions don't churn every
   *  entry — only the user-facing handles in the popover need a label. */
  readonly label?: string
  readonly accepts: (sourceType: string) => boolean
}

/**
 * Sources whose output contributes a USABLE prompt-hint clause to
 * camera-motion / transition targets. This is a VISUAL subset of the
 * dispatch cases in `packages/shared/src/parameter-prompt-hint.ts` — audio
 * pickers (music-genre / music-mood / instrumentation / voice-*) DO have
 * cases in that switch, but their fragments are musical and nonsensical
 * on a video-motion wire, so they're excluded here.
 *
 * Size + content pinned by the drift-catcher test in
 * `target-handle-registry.test.ts` — adding a new visual picker means
 * updating that count, which forces a deliberate change rather than a
 * silent drift.
 *
 * MODULE-INIT GUARD: VISUAL_PARAMETER_PICKER_NODE_TYPES MUST be a non-empty
 * Set when this module loads. If it isn't, the spread silently produces
 * a Set containing only the two literals ("tone", "text-prompt"), which
 * passes a naive size check but represents a real misconfiguration
 * (parameter-picker-types export was renamed / cleared) that would
 * cascade into broken camera-motion / transition wiring.
 *
 * The previous size===0 guard was unreachable because the unconditional
 * literals made size >= 2 always — replaced here with an INPUT-side
 * check on the spread source.
 *
 * Recovery strategy: console.error + degraded fallback instead of
 * throwing at module init. A throw here takes down the entire editor
 * (the module is statically imported by the canvas + popover), and a
 * future circular-import or HMR race condition that briefly makes
 * VISUAL_PARAMETER_PICKER_NODE_TYPES undefined would be impossible to
 * diagnose. Better: log loudly and continue with an empty visual-picker
 * spread — typed-handle validation will be incomplete (camera-motion /
 * transition state handles won't accept visual pickers, only tone +
 * text-prompt) but the editor still loads.
 */
let _visualPickerSet: ReadonlySet<string> = VISUAL_PARAMETER_PICKER_NODE_TYPES
if (
  !(VISUAL_PARAMETER_PICKER_NODE_TYPES instanceof Set) ||
  VISUAL_PARAMETER_PICKER_NODE_TYPES.size === 0
) {
  console.error(
    "[target-handle-registry] VISUAL_PARAMETER_PICKER_NODE_TYPES is missing or empty — " +
    "typed-handle validation will be incomplete (visual pickers won't accept on camera-motion / transition state handles). " +
    "Check parameter-picker-types.ts for export issues or a circular import.",
  )
  _visualPickerSet = new Set<string>()
}
const HINT_PRODUCER_TYPES: ReadonlySet<string> = new Set<string>([
  ..._visualPickerSet,
  "tone",
  "text-prompt",
])

/**
 * Camera-motion / transition startState+endState handles accept any source
 * whose output contributes a usable visual prompt-hint fragment. Drift is
 * caught by `target-handle-registry.test.ts` (pinned size + contained
 * tokens + audio exclusion).
 */
export const ACCEPTS_PARAMETER_PICKER = (sourceType: string): boolean => HINT_PRODUCER_TYPES.has(sourceType)

/**
 * Character-fx's `target` handle accepts identity-locking ref nodes only —
 * character / face / object / location. See
 * packages/shared/src/parameter-prompt-hint.ts:178-202: the character-fx
 * branch walks incoming edges on `targetHandle === "target"` and calls
 * `extractCharacterRefName(src)`, which extracts the `characterName` /
 * `faceName` / `objectName` / `locationName` field from one of those four
 * ref types. Pickers / image producers contribute nothing here.
 */
export const ACCEPTS_CHARACTER_REF = (sourceType: string): boolean => IDENTITY_TYPES.has(sourceType)

/**
 * Reference Sheet's `in` handle accepts ONLY the three composable entity kinds —
 * character / object / location. Deliberately NARROWER than ACCEPTS_CHARACTER_REF
 * (which also admits `face`): the reference-sheet route + worker only know how to
 * load panels from `characters` / `objects` / `locations` rows (see
 * `routes/reference-sheet.ts` TABLE map + `EntityKind` in @nodaro/shared). A face
 * has no panel buckets, so it must not light up the pip or pass drop validation.
 */
export const ACCEPTS_ENTITY_REF = (sourceType: string): boolean =>
  sourceType === "character" || sourceType === "object" || sourceType === "location"

/**
 * Lottie Overlay's `lottie` target accepts authored-animation producers — the
 * motion-graphics node running its Lottie engine, which emits the authored
 * Lottie JSON's R2 URL on its `lottie` source handle (Phase 4). The runtime
 * resolver (input-resolver.ts) routes any URL on the `lottie` targetHandle into
 * `lottieAssets`, but only motion-graphics produces a placeable Lottie document,
 * so only it lights up the pip + appears as a source-direction candidate.
 */
export const ACCEPTS_LOTTIE_ASSET = (sourceType: string): boolean => sourceType === "motion-graphics"

/** Friendly labels for Generate Image's six input handles, used by the
 *  candidate-row chip in source-direction popovers. */
const GENERATE_IMAGE_HANDLE_LABELS: Record<string, string> = {
  prompt: "Prompt",
  negative: "Negative",
  references: "References",
  assets: "Assets",
  elements: "Elements",
  look: "Look",
}

/**
 * Per-node-type list of target handles + their accept predicates.
 * Source-direction popovers walk this map to find candidate consumers.
 *
 * As more nodes adopt typed handles (Edit Image, I2V, etc. — separate
 * playbook migration), they each register here too.
 */
export const TARGET_HANDLE_ACCEPTS: Record<string, ReadonlyArray<TargetHandleEntry>> = {
  // Generate Image uses the VISUAL-picker predicate (audio pickers like
  // music-genre / voice-* never feed a still-image target). This matches
  // connection-validation.ts:71 so the pip's "valid candidate" highlight
  // and the actual drop validator agree — without this alignment, audio
  // pickers light up Generate Image's pip during a drag but the drop fails.
  "generate-image": GENERATE_IMAGE_INPUT_HANDLES.map((handleId) => ({
    handleId,
    label: GENERATE_IMAGE_HANDLE_LABELS[handleId] ?? handleId,
    accepts: (sourceType: string) =>
      isValidGenerateImageConnection(handleId, sourceType, isVisualPickerType),
  })),
  "camera-motion": [
    { handleId: "startState", label: "Start state", accepts: ACCEPTS_PARAMETER_PICKER },
    { handleId: "endState",   label: "End state",   accepts: ACCEPTS_PARAMETER_PICKER },
  ],
  // Transition mirrors camera-motion: its startState/endState wires carry
  // prompt hints from parameter pickers, not image frames. See
  // packages/shared/src/parameter-prompt-hint.ts:150-176 (transition branch
  // walks incoming edges and calls getParameterPromptHint on each source).
  "transition": [
    { handleId: "startState", label: "Start state", accepts: ACCEPTS_PARAMETER_PICKER },
    { handleId: "endState",   label: "End state",   accepts: ACCEPTS_PARAMETER_PICKER },
  ],
  // Character-fx accepts ONLY identity refs on its `target` handle. The
  // shared hint-builder reads `characterName`/`faceName`/`objectName`/
  // `locationName` from the source — pickers and image producers contribute
  // nothing.
  "character-fx": [
    { handleId: "target", label: "Target subject", accepts: ACCEPTS_CHARACTER_REF },
  ],

  // Reference Sheet takes ONE entity ref on its `in` handle (character / object /
  // location). The executor walks this edge to the upstream entity's (kind, DB id)
  // and composes a sheet from the panels that entity already has.
  "reference-sheet": [
    { handleId: "in", label: "Subject", accepts: ACCEPTS_ENTITY_REF },
  ],

  // FFmpeg / pure-processing nodes — every entry's accepts predicate
  // mirrors `isValidFfmpegConnection` in ffmpeg-handles.ts. Source-
  // direction popovers (drag from a producer's output pip) walk this
  // map to find which ffmpeg consumers + handles light up.
  "trim-video":         [{ handleId: "in", label: "Video", accepts: ACCEPTS_VIDEO }],
  "combine-videos":     [{ handleId: "in", label: "Video", accepts: ACCEPTS_VIDEO }],
  "extract-frame":      [{ handleId: "in", label: "Video", accepts: ACCEPTS_VIDEO }],
  "loop-video":         [{ handleId: "in", label: "Video", accepts: ACCEPTS_VIDEO }],
  "resize-video":       [{ handleId: "in", label: "Video", accepts: ACCEPTS_VIDEO }],
  "add-captions":       [{ handleId: "in", label: "Video", accepts: ACCEPTS_VIDEO }],
  "extract-audio":      [{ handleId: "in", label: "Video", accepts: ACCEPTS_VIDEO }],
  "remove-audio":       [{ handleId: "in", label: "Video", accepts: ACCEPTS_VIDEO }],
  "trim-audio":         [{ handleId: "in", label: "Audio", accepts: ACCEPTS_AUDIO }],
  "combine-audio":      [{ handleId: "in", label: "Audio", accepts: ACCEPTS_AUDIO }],
  "mix-audio":          [{ handleId: "in", label: "Audio", accepts: ACCEPTS_AUDIO }],
  "merge-video-audio":  [{ handleId: "in", label: "Video + Audio", accepts: ACCEPTS_MEDIA }],
  "adjust-volume":      [{ handleId: "in", label: "Video or Audio", accepts: ACCEPTS_MEDIA }],

  // Lottie Overlay — `video` accepts video producers; `lottie` accepts the
  // motion-graphics lottie engine (authored animation assets). Lets a
  // motion-graphics source pip's popover surface "→ Lottie" as a candidate.
  "lottie-overlay":     [
    { handleId: "video",  label: "Video",  accepts: ACCEPTS_VIDEO },
    { handleId: "lottie", label: "Lottie", accepts: ACCEPTS_LOTTIE_ASSET },
  ],

  // ─── Audio & Speech (Batch 1 of audio/text typed-handles migration) ───
  // Each predicate's accepts is built inline from the per-handle predicate
  // in audio-text-handles.ts so source-direction popover candidate
  // enumeration uses the SAME rules as drag-to-connect validation.
  "text-to-speech": [
    { handleId: "prompt", label: AUDIO_TEXT_HANDLE_LABELS["text-to-speech"].prompt, accepts: (s) => isValidTextToSpeechConnection("prompt", s, isVisualPickerType) },
  ],
  "text-to-audio": [
    { handleId: "prompt",       label: AUDIO_TEXT_HANDLE_LABELS["text-to-audio"].prompt,         accepts: (s) => isValidTextToAudioConnection("prompt",       s, isVisualPickerType) },
    { handleId: "audio-style",  label: AUDIO_TEXT_HANDLE_LABELS["text-to-audio"]["audio-style"], accepts: (s) => isValidTextToAudioConnection("audio-style",  s, isVisualPickerType) },
  ],
  "generate-music": [
    { handleId: "prompt",       label: AUDIO_TEXT_HANDLE_LABELS["generate-music"].prompt,         accepts: (s) => isValidGenerateMusicConnection("prompt",       s, isVisualPickerType) },
    { handleId: "ref-audio",    label: AUDIO_TEXT_HANDLE_LABELS["generate-music"]["ref-audio"],   accepts: (s) => isValidGenerateMusicConnection("ref-audio",    s, isVisualPickerType) },
    { handleId: "audio-style",  label: AUDIO_TEXT_HANDLE_LABELS["generate-music"]["audio-style"], accepts: (s) => isValidGenerateMusicConnection("audio-style",  s, isVisualPickerType) },
  ],
  "audio-isolation": [
    { handleId: "audio", label: AUDIO_TEXT_HANDLE_LABELS["audio-isolation"].audio, accepts: (s) => isValidAudioIsolationConnection("audio", s) },
  ],
  "text-to-dialogue": [
    { handleId: "prompt", label: AUDIO_TEXT_HANDLE_LABELS["text-to-dialogue"].prompt, accepts: (s) => isValidTextToDialogueConnection("prompt", s, isVisualPickerType) },
  ],
  "voice-changer": [
    { handleId: "audio", label: AUDIO_TEXT_HANDLE_LABELS["voice-changer"].audio, accepts: (s) => isValidVoiceChangerConnection("audio", s) },
  ],
  "dubbing": [
    { handleId: "audio", label: AUDIO_TEXT_HANDLE_LABELS["dubbing"].audio, accepts: (s) => isValidDubbingConnection("audio", s) },
  ],
  "voice-remix": [
    { handleId: "audio",        label: AUDIO_TEXT_HANDLE_LABELS["voice-remix"].audio,           accepts: (s) => isValidVoiceRemixConnection("audio",        s) },
    { handleId: "audio-style",  label: AUDIO_TEXT_HANDLE_LABELS["voice-remix"]["audio-style"],  accepts: (s) => isValidVoiceRemixConnection("audio-style",  s) },
  ],
  "voice-design": [
    { handleId: "prompt",       label: AUDIO_TEXT_HANDLE_LABELS["voice-design"].prompt,           accepts: (s) => isValidVoiceDesignConnection("prompt",      s, isVisualPickerType) },
    { handleId: "audio-style",  label: AUDIO_TEXT_HANDLE_LABELS["voice-design"]["audio-style"],   accepts: (s) => isValidVoiceDesignConnection("audio-style", s, isVisualPickerType) },
  ],
  "forced-alignment": [
    { handleId: "audio",      label: AUDIO_TEXT_HANDLE_LABELS["forced-alignment"].audio,      accepts: (s) => isValidForcedAlignmentConnection("audio",      s) },
    { handleId: "transcript", label: AUDIO_TEXT_HANDLE_LABELS["forced-alignment"].transcript, accepts: (s) => isValidForcedAlignmentConnection("transcript", s) },
  ],

  // ─── AI > Suno Music (Batch 2 of audio/text typed-handles migration) ──
  "suno-generate": [
    { handleId: "prompt",       label: AUDIO_TEXT_HANDLE_LABELS["suno-generate"].prompt,         accepts: (s) => isValidSunoGenerateConnection("prompt",       s, isVisualPickerType) },
    { handleId: "audio-style",  label: AUDIO_TEXT_HANDLE_LABELS["suno-generate"]["audio-style"], accepts: (s) => isValidSunoGenerateConnection("audio-style",  s, isVisualPickerType) },
    { handleId: "voice",        label: AUDIO_TEXT_HANDLE_LABELS["suno-generate"].voice,          accepts: (s) => isValidSunoGenerateConnection("voice",        s, isVisualPickerType) },
  ],
  "suno-cover": [
    { handleId: "audio",  label: AUDIO_TEXT_HANDLE_LABELS["suno-cover"].audio,  accepts: (s) => isValidSunoCoverConnection("audio",  s, isVisualPickerType) },
    { handleId: "prompt", label: AUDIO_TEXT_HANDLE_LABELS["suno-cover"].prompt, accepts: (s) => isValidSunoCoverConnection("prompt", s, isVisualPickerType) },
    { handleId: "voice",  label: AUDIO_TEXT_HANDLE_LABELS["suno-cover"].voice,  accepts: (s) => isValidSunoCoverConnection("voice",  s, isVisualPickerType) },
  ],
  "suno-extend": [
    { handleId: "audio",  label: AUDIO_TEXT_HANDLE_LABELS["suno-extend"].audio,  accepts: (s) => isValidSunoExtendConnection("audio",  s, isVisualPickerType) },
    { handleId: "prompt", label: AUDIO_TEXT_HANDLE_LABELS["suno-extend"].prompt, accepts: (s) => isValidSunoExtendConnection("prompt", s, isVisualPickerType) },
    { handleId: "voice",  label: AUDIO_TEXT_HANDLE_LABELS["suno-extend"].voice,  accepts: (s) => isValidSunoExtendConnection("voice",  s, isVisualPickerType) },
  ],
  "suno-lyrics": [
    { handleId: "prompt", label: AUDIO_TEXT_HANDLE_LABELS["suno-lyrics"].prompt, accepts: (s) => isValidSunoLyricsConnection("prompt", s, isVisualPickerType) },
  ],
  "suno-separate": [
    { handleId: "audio", label: AUDIO_TEXT_HANDLE_LABELS["suno-separate"].audio, accepts: (s) => isValidSunoSeparateConnection("audio", s) },
  ],
  "suno-music-video": [
    { handleId: "audio", label: AUDIO_TEXT_HANDLE_LABELS["suno-music-video"].audio, accepts: (s) => isValidSunoMusicVideoConnection("audio", s) },
  ],
  "suno-mashup": [
    { handleId: "audio1", label: AUDIO_TEXT_HANDLE_LABELS["suno-mashup"].audio1, accepts: (s) => isValidSunoMashupConnection("audio1", s) },
    { handleId: "audio2", label: AUDIO_TEXT_HANDLE_LABELS["suno-mashup"].audio2, accepts: (s) => isValidSunoMashupConnection("audio2", s) },
  ],
  "suno-replace-section": [
    { handleId: "audio",  label: AUDIO_TEXT_HANDLE_LABELS["suno-replace-section"].audio,  accepts: (s) => isValidSunoReplaceSectionConnection("audio",  s, isVisualPickerType) },
    { handleId: "prompt", label: AUDIO_TEXT_HANDLE_LABELS["suno-replace-section"].prompt, accepts: (s) => isValidSunoReplaceSectionConnection("prompt", s, isVisualPickerType) },
  ],
  "suno-style-boost": [
    { handleId: "prompt", label: AUDIO_TEXT_HANDLE_LABELS["suno-style-boost"].prompt, accepts: (s) => isValidSunoStyleBoostConnection("prompt", s, isVisualPickerType) },
  ],
  "suno-add-instrumental": [
    { handleId: "audio", label: AUDIO_TEXT_HANDLE_LABELS["suno-add-instrumental"].audio, accepts: (s) => isValidSunoAddInstrumentalConnection("audio", s) },
  ],
  "suno-add-vocals": [
    { handleId: "audio", label: AUDIO_TEXT_HANDLE_LABELS["suno-add-vocals"].audio, accepts: (s) => isValidSunoAddVocalsConnection("audio", s) },
  ],
  "suno-convert-wav": [
    { handleId: "audio", label: AUDIO_TEXT_HANDLE_LABELS["suno-convert-wav"].audio, accepts: (s) => isValidSunoConvertWavConnection("audio", s) },
  ],
  "suno-upload-extend": [
    { handleId: "audio",  label: AUDIO_TEXT_HANDLE_LABELS["suno-upload-extend"].audio,  accepts: (s) => isValidSunoUploadExtendConnection("audio",  s, isVisualPickerType) },
    { handleId: "prompt", label: AUDIO_TEXT_HANDLE_LABELS["suno-upload-extend"].prompt, accepts: (s) => isValidSunoUploadExtendConnection("prompt", s, isVisualPickerType) },
  ],

  // ─── AI > Script & Text (Batch 3 of audio/text typed-handles migration) ──
  "generate-script": [
    { handleId: "prompt", label: AUDIO_TEXT_HANDLE_LABELS["generate-script"].prompt, accepts: (s) => isValidGenerateScriptConnection("prompt", s, isVisualPickerType) },
  ],
  "llm-chat": [
    { handleId: "prompt",        label: AUDIO_TEXT_HANDLE_LABELS["llm-chat"].prompt,            accepts: (s) => isValidLlmChatConnection("prompt",        s, isVisualPickerType) },
    { handleId: "references",    label: AUDIO_TEXT_HANDLE_LABELS["llm-chat"].references,        accepts: (s) => isValidLlmChatConnection("references",    s, isVisualPickerType) },
    { handleId: "system-prompt", label: AUDIO_TEXT_HANDLE_LABELS["llm-chat"]["system-prompt"],  accepts: (s) => isValidLlmChatConnection("system-prompt", s, isVisualPickerType) },
  ],
  "transcribe": [
    { handleId: "audio", label: AUDIO_TEXT_HANDLE_LABELS["transcribe"].audio, accepts: (s) => isValidTranscribeConnection("audio", s) },
  ],

  // ─── Processing > Audio + Text (Batch 4, non-ffmpeg-overlapping only) ─
  // merge-video-audio, trim-audio, mix-audio, combine-audio, adjust-volume
  // are already registered above under the FFmpeg block (shipped in #2809).
  "split-media": [
    { handleId: "video", label: AUDIO_TEXT_HANDLE_LABELS["split-media"].video, accepts: (s) => isValidSplitMediaConnection("video", s) },
    { handleId: "audio", label: AUDIO_TEXT_HANDLE_LABELS["split-media"].audio, accepts: (s) => isValidSplitMediaConnection("audio", s) },
  ],
  "combine-text": [
    { handleId: "text", label: AUDIO_TEXT_HANDLE_LABELS["combine-text"].text, accepts: (s) => isValidCombineTextConnection("text", s, isVisualPickerType) },
  ],
  "split-text": [
    { handleId: "text", label: AUDIO_TEXT_HANDLE_LABELS["split-text"].text, accepts: (s) => isValidSplitTextConnection("text", s) },
  ],
  "preview": [
    { handleId: "in", label: AUDIO_TEXT_HANDLE_LABELS["preview"].in, accepts: (_s) => isValidPreviewConnection("in") },
  ],

  // ─── Data root-category nodes ─────────────────────────────────────────
  // Source-direction popovers walk this map; entries here let "drag from an
  // output pip" enumerate data-node target handles as candidates. The
  // loop-node case is omitted intentionally — its per-column accepts depend
  // on the column type stored in node data, which this registry's static
  // shape can't reach. The loop component's own per-pip accepts predicate
  // handles target-direction visual filtering.
  "list": [
    { handleId: "in", label: "Items", accepts: (s) => isValidListNodeConnection("in", s, isVisualPickerType) },
  ],
  // text-prompt's `in` handle was migrated from the legacy invisible
  // <Handle> to HandleWithPopover (typed pip + popover). Register here so
  // source-direction popovers from upstream producers list it as a
  // candidate consumer. Accepts any data producer — same gate as the
  // node's own `accepts` predicate, so popover candidates match drop
  // validation exactly.
  "text-prompt": [
    { handleId: "in", label: "Text", accepts: (s) => isDataProducer(s, isVisualPickerType) },
  ],
  "web-scrape": [
    { handleId: "in", label: "URL / Query", accepts: (s) => isValidWebScrapeConnection("in", s) },
  ],
  "extract-field": [
    { handleId: "in", label: "Source", accepts: (s) => isValidExtractFieldConnection("in", s) },
  ],
  "filter-list": [
    { handleId: "in", label: "List", accepts: (s) => isValidFilterListConnection("in", s, isVisualPickerType) },
    { handleId: "variables", label: "Variables", accepts: (s) => isValidFilterListConnection("variables", s, isVisualPickerType) },
  ],
  "deduplicate": [
    { handleId: "in", label: "List", accepts: (s) => isValidDeduplicateConnection("in", s) },
  ],
  "merge-lists": [
    { handleId: "in", label: "Lists", accepts: (s) => isValidMergeListsConnection("in", s) },
  ],
  "sort-list": [
    { handleId: "in", label: "List", accepts: (s) => isValidSortListConnection("in", s) },
  ],
  "selector": [
    { handleId: "in",        label: "List",      accepts: (s) => isValidSelectorConnection("in",        s, isVisualPickerType) },
    { handleId: "variables", label: "Variables", accepts: (s) => isValidSelectorConnection("variables", s, isVisualPickerType) },
  ],
  // ─── Image-producer nodes (Phase 20 of typed-handles migration) ──────
  "edit-image": [
    { handleId: "image",          label: IMAGE_PRODUCER_HANDLE_LABELS["edit-image"].image,          accepts: (s) => isValidEditImageConnection("image",          s, isVisualPickerType) },
    { handleId: "mask",           label: IMAGE_PRODUCER_HANDLE_LABELS["edit-image"].mask,           accepts: (s) => isValidEditImageConnection("mask",           s, isVisualPickerType) },
    { handleId: "cinematography", label: IMAGE_PRODUCER_HANDLE_LABELS["edit-image"].cinematography, accepts: (s) => isValidEditImageConnection("cinematography", s, isVisualPickerType) },
  ],
  "modify-image": [
    { handleId: "image",          label: IMAGE_PRODUCER_HANDLE_LABELS["modify-image"].image,          accepts: (s) => isValidModifyImageConnection("image",          s, isVisualPickerType) },
    { handleId: "mask",           label: IMAGE_PRODUCER_HANDLE_LABELS["modify-image"].mask,           accepts: (s) => isValidModifyImageConnection("mask",           s, isVisualPickerType) },
    { handleId: "cinematography", label: IMAGE_PRODUCER_HANDLE_LABELS["modify-image"].cinematography, accepts: (s) => isValidModifyImageConnection("cinematography", s, isVisualPickerType) },
  ],
  "image-to-image": [
    { handleId: "image",          label: IMAGE_PRODUCER_HANDLE_LABELS["image-to-image"].image,          accepts: (s) => isValidImageToImageConnection("image",          s, isVisualPickerType) },
    { handleId: "mask",           label: IMAGE_PRODUCER_HANDLE_LABELS["image-to-image"].mask,           accepts: (s) => isValidImageToImageConnection("mask",           s, isVisualPickerType) },
    { handleId: "cinematography", label: IMAGE_PRODUCER_HANDLE_LABELS["image-to-image"].cinematography, accepts: (s) => isValidImageToImageConnection("cinematography", s, isVisualPickerType) },
  ],
  "generate-mask": [
    { handleId: "image", label: IMAGE_PRODUCER_HANDLE_LABELS["generate-mask"].image, accepts: (s) => isValidGenerateMaskConnection("image", s) },
  ],
  "upscale-image": [
    { handleId: "image", label: IMAGE_PRODUCER_HANDLE_LABELS["upscale-image"].image, accepts: (s) => isValidUpscaleImageConnection("image", s) },
  ],
  "remove-background": [
    { handleId: "image", label: IMAGE_PRODUCER_HANDLE_LABELS["remove-background"].image, accepts: (s) => isValidRemoveBackgroundConnection("image", s) },
  ],
  "face-swap": [
    { handleId: "face",  label: IMAGE_PRODUCER_HANDLE_LABELS["face-swap"].face,  accepts: (s) => isValidFaceSwapConnection("face",  s) },
    { handleId: "video", label: IMAGE_PRODUCER_HANDLE_LABELS["face-swap"].video, accepts: (s) => isValidFaceSwapConnection("video", s) },
  ],
  "image-to-text": [
    { handleId: "image", label: IMAGE_PRODUCER_HANDLE_LABELS["image-to-text"].image, accepts: (s) => isValidImageToTextConnection("image", s) },
    { handleId: "video", label: IMAGE_PRODUCER_HANDLE_LABELS["image-to-text"].video, accepts: (s) => isValidImageToTextConnection("video", s) },
    { handleId: "text",  label: IMAGE_PRODUCER_HANDLE_LABELS["image-to-text"].text,  accepts: (s) => isValidImageToTextConnection("text",  s) },
  ],

  // ─── Video-producer nodes (Phase 21 of typed-handles migration) ──────
  "video-to-video": [
    { handleId: "video",          label: VIDEO_PRODUCER_HANDLE_LABELS["video-to-video"].video,          accepts: (s) => isValidVideoToVideoConnection("video",          s, isVisualPickerType) },
    { handleId: "cinematography", label: VIDEO_PRODUCER_HANDLE_LABELS["video-to-video"].cinematography, accepts: (s) => isValidVideoToVideoConnection("cinematography", s, isVisualPickerType) },
  ],
  "video-upscale": [
    { handleId: "video", label: VIDEO_PRODUCER_HANDLE_LABELS["video-upscale"].video, accepts: (s) => isValidVideoUpscaleConnection("video", s) },
  ],
  "extend-video": [
    { handleId: "video",          label: VIDEO_PRODUCER_HANDLE_LABELS["extend-video"].video,          accepts: (s) => isValidExtendVideoConnection("video",          s, isVisualPickerType) },
    { handleId: "cinematography", label: VIDEO_PRODUCER_HANDLE_LABELS["extend-video"].cinematography, accepts: (s) => isValidExtendVideoConnection("cinematography", s, isVisualPickerType) },
  ],
  "lip-sync": [
    { handleId: "image", label: VIDEO_PRODUCER_HANDLE_LABELS["lip-sync"].image, accepts: (s) => isValidLipSyncConnection("image", s) },
    { handleId: "video", label: VIDEO_PRODUCER_HANDLE_LABELS["lip-sync"].video, accepts: (s) => isValidLipSyncConnection("video", s) },
    { handleId: "audio", label: VIDEO_PRODUCER_HANDLE_LABELS["lip-sync"].audio, accepts: (s) => isValidLipSyncConnection("audio", s) },
  ],
  "speech-to-video": [
    { handleId: "image",          label: VIDEO_PRODUCER_HANDLE_LABELS["speech-to-video"].image,          accepts: (s) => isValidSpeechToVideoConnection("image",          s, isVisualPickerType) },
    { handleId: "audio",          label: VIDEO_PRODUCER_HANDLE_LABELS["speech-to-video"].audio,          accepts: (s) => isValidSpeechToVideoConnection("audio",          s, isVisualPickerType) },
    { handleId: "prompt",         label: VIDEO_PRODUCER_HANDLE_LABELS["speech-to-video"].prompt,         accepts: (s) => isValidSpeechToVideoConnection("prompt",         s, isVisualPickerType) },
    { handleId: "cinematography", label: VIDEO_PRODUCER_HANDLE_LABELS["speech-to-video"].cinematography, accepts: (s) => isValidSpeechToVideoConnection("cinematography", s, isVisualPickerType) },
  ],
  "motion-transfer": [
    { handleId: "video", label: VIDEO_PRODUCER_HANDLE_LABELS["motion-transfer"].video, accepts: (s) => isValidMotionTransferConnection("video", s) },
  ],
  "ai-avatar": [
    { handleId: "image",  label: VIDEO_PRODUCER_HANDLE_LABELS["ai-avatar"].image,  accepts: (s) => isValidAiAvatarConnection("image",  s, isVisualPickerType) },
    { handleId: "script", label: VIDEO_PRODUCER_HANDLE_LABELS["ai-avatar"].script, accepts: (s) => isValidAiAvatarConnection("script", s, isVisualPickerType) },
    { handleId: "audio",  label: VIDEO_PRODUCER_HANDLE_LABELS["ai-avatar"].audio,  accepts: (s) => isValidAiAvatarConnection("audio",  s, isVisualPickerType) },
  ],
  // Cinematic Avatar — generative `prompt` input (text producers + pickers +
  // dynamic producers, mirroring motion-transfer / speech-to-video) plus three
  // OPTIONAL reference inputs (one upstream producer each): ref-video (video),
  // ref-audio (audio), ref-image (image), resolved into HeyGen's `references`.
  "cinematic-avatar": [
    { handleId: "prompt",    label: VIDEO_PRODUCER_HANDLE_LABELS["cinematic-avatar"].prompt,        accepts: (s) => isValidCinematicAvatarConnection("prompt",    s, isVisualPickerType) },
    { handleId: "ref-video", label: VIDEO_PRODUCER_HANDLE_LABELS["cinematic-avatar"]["ref-video"], accepts: (s) => isValidCinematicAvatarConnection("ref-video", s, isVisualPickerType) },
    { handleId: "ref-audio", label: VIDEO_PRODUCER_HANDLE_LABELS["cinematic-avatar"]["ref-audio"], accepts: (s) => isValidCinematicAvatarConnection("ref-audio", s, isVisualPickerType) },
    { handleId: "ref-image", label: VIDEO_PRODUCER_HANDLE_LABELS["cinematic-avatar"]["ref-image"], accepts: (s) => isValidCinematicAvatarConnection("ref-image", s, isVisualPickerType) },
  ],

  // ─── Identity nodes (Phase 23 of typed-handles migration) ────────────
  "character": [
    { handleId: "in", label: IDENTITY_HANDLE_LABELS["character"].in, accepts: (s) => isValidCharacterConnection("in", s, isVisualPickerType) },
  ],
  "face": [
    { handleId: "in", label: IDENTITY_HANDLE_LABELS["face"].in, accepts: (s) => isValidFaceConnection("in", s, isVisualPickerType) },
  ],
  "object": [
    { handleId: "in",   label: IDENTITY_HANDLE_LABELS["object"].in,   accepts: (s) => isValidObjectConnection("in",   s, isVisualPickerType) },
    { handleId: "type", label: IDENTITY_HANDLE_LABELS["object"].type, accepts: (s) => isValidObjectConnection("type", s, isVisualPickerType) },
  ],
  "location": [
    { handleId: "in",             label: IDENTITY_HANDLE_LABELS["location"].in,             accepts: (s) => isValidLocationConnection("in",             s, isVisualPickerType) },
    { handleId: "cinematography", label: IDENTITY_HANDLE_LABELS["location"].cinematography, accepts: (s) => isValidLocationConnection("cinematography", s, isVisualPickerType) },
  ],
}

export interface TargetCandidateMatch {
  readonly nodeType: string
  readonly handleId: string
}

/**
 * Reverse lookup: given a source node type, return every (nodeType, handleId)
 * pair whose accepts predicate returns true for it. Used by source-direction
 * popovers in HandlePopover for candidate enumeration.
 */
export function getTargetHandlesAccepting(sourceType: string): ReadonlyArray<TargetCandidateMatch> {
  const out: TargetCandidateMatch[] = []
  for (const [nodeType, entries] of Object.entries(TARGET_HANDLE_ACCEPTS)) {
    for (const entry of entries) {
      if (entry.accepts(sourceType)) out.push({ nodeType, handleId: entry.handleId })
    }
  }
  return out
}
