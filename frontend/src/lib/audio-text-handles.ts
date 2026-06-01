/**
 * Per-node typed-handle predicates for the Audio & Speech, Suno Music,
 * Script & Text, and Processing (Audio + Text) categories.
 *
 * Each `isValid<Node>Connection(targetHandleId, sourceType, isPickerType)`
 * returns true iff the source node type is allowed on the given target
 * handle. The same predicates are called from `connection-validation.ts`
 * (drag-to-connect) AND `HandlePopover` (one-click Connect button), so
 * routing and visual-candidate highlight always agree.
 *
 * Convention:
 *  - `isPickerType` is the visual-picker predicate. Audio-style pickers
 *    (music-genre / music-mood / instrumentation / voice-character /
 *    voice-delivery) are explicitly enumerated in AUDIO_PICKER_TYPES below
 *    rather than reusing the generic isPickerType — pickers in the visual
 *    family don't apply to e.g. an audio-style slot on Generate Music.
 *  - text + audio + video producer sets are imported from existing modules
 *    so a single change there propagates to every consumer's accepts logic.
 *
 ***REDACTED-OSS-SCRUB***
 ***REDACTED-OSS-SCRUB***
 */

import { AUDIO_PRODUCER_TYPES, VIDEO_PRODUCER_TYPES, DYNAMIC_PRODUCER_TYPES } from "@nodaro/shared"
import { TEXT_PRODUCER_TYPES, IMAGE_PRODUCER_TYPES } from "./generate-image-handles"

/** Helpers that mirror `ffmpeg-handles.ts`'s ACCEPTS_VIDEO / ACCEPTS_AUDIO:
 *  every typed audio/video/text handle below accepts a producer of the
 *  matching kind OR a `DYNAMIC_PRODUCER_TYPES` source (loop / list /
 *  sub-workflow / reduce / adjust-volume) whose runtime output type the
 *  orchestrator decides at execution time. Without OR'ing this in, the
 *  canvas validator would hard-reject edges that the backend resolver
 *  would happily route — the same drift bug #2823 fixed for image/video. */
const ACCEPTS_AUDIO_OR_DYN = (s: string): boolean =>
  AUDIO_PRODUCER_TYPES.has(s) || DYNAMIC_PRODUCER_TYPES.has(s)
const ACCEPTS_VIDEO_OR_DYN = (s: string): boolean =>
  VIDEO_PRODUCER_TYPES.has(s) || DYNAMIC_PRODUCER_TYPES.has(s)
const ACCEPTS_TEXT_OR_DYN = (s: string): boolean =>
  TEXT_PRODUCER_TYPES.has(s) || DYNAMIC_PRODUCER_TYPES.has(s)

/** Audio-domain pickers + tone + text-prompt — the sources that contribute
 *  a usable audio/style/voice fragment when wired into a Suno / ElevenLabs /
 *  audio-generation slot. Mirrors `AUDIO_PARAMETER_PICKER_NODE_TYPES` from
 *  parameter-picker-types.ts but adds tone/text-prompt (free-text hint
 *  producers). */
export const AUDIO_PICKER_TYPES: ReadonlySet<string> = new Set<string>([
  "music-genre",
  "music-mood",
  "instrumentation",
  "voice-character",
  "voice-delivery",
  "tone",
  "text-prompt",
])

/** Voice-persona producers: nodes whose output is a "use this voice" data
 *  reference (not an audio clip). suno-voice produces a voice-persona id;
 *  voice-character is a parameter picker that selects a voice id.
 *  voice-design also emits a voiceId data output. */
export const VOICE_PERSONA_TYPES: ReadonlySet<string> = new Set<string>([
  "suno-voice",
  "voice-character",
  "voice-design",
])

/** Picker types whose output text feeds a `prompt` handle (text-producer
 *  alternative — pickers contribute a prompt-fragment instead of a full
 *  string). All visual + audio pickers + tone + text-prompt. */
const PICKER_FOR_PROMPT: (sourceType: string, isVisualPicker: (t: string) => boolean) => boolean =
  (sourceType, isVisualPicker) => AUDIO_PICKER_TYPES.has(sourceType) || isVisualPicker(sourceType)

/** Convenience predicate combining text producers + pickers + dynamic
 *  producers — every `prompt` slot accepts this exact union. */
const ACCEPTS_PROMPT = (
  sourceType: string,
  isVisualPicker: (t: string) => boolean,
): boolean =>
  ACCEPTS_TEXT_OR_DYN(sourceType) || PICKER_FOR_PROMPT(sourceType, isVisualPicker)

/** Sources accepted on an `audio-style` target handle. The runtime
 *  consumers (`audio-style-hints.ts`, `sound-aggregator.ts`,
 *  `connected-audio-sources.tsx`) all filter edges by literal
 *  `targetHandle === "audio-style"` and walk the upstream node looking
 *  for a hint fragment — so this predicate must accept the union of
 *  everything those consumers know how to interpret: audio-domain
 *  pickers (music-genre / music-mood / instrumentation / voice-character /
 *  voice-delivery), free-text hint producers (tone / text-prompt), and
 *  voice-persona refs (suno-voice / voice-design's voiceId output) that
 *  the hint builder reads `voiceName` / `style` from. */
function isAudioStyleSource(sourceType: string): boolean {
  return (
    AUDIO_PICKER_TYPES.has(sourceType) ||
    VOICE_PERSONA_TYPES.has(sourceType)
  )
}

// ─── Batch 1: AI > Audio & Speech ─────────────────────────────────────

/** text-to-speech: prompt (text + picker). */
export function isValidTextToSpeechConnection(
  targetHandleId: string,
  sourceType: string,
  isVisualPicker: (t: string) => boolean,
): boolean {
  switch (targetHandleId) {
    case "prompt":
      return ACCEPTS_PROMPT(sourceType, isVisualPicker)
    default:
      return false
  }
}

/** text-to-audio: prompt (text + picker), audio-style (audio pickers). */
export function isValidTextToAudioConnection(
  targetHandleId: string,
  sourceType: string,
  isVisualPicker: (t: string) => boolean,
): boolean {
  switch (targetHandleId) {
    case "prompt":
      return ACCEPTS_PROMPT(sourceType, isVisualPicker)
    case "audio-style":
      return AUDIO_PICKER_TYPES.has(sourceType)
    default:
      return false
  }
}

/** generate-music: prompt, ref-audio (audio producers, order-matters),
 *  audio-style (audio pickers). */
export function isValidGenerateMusicConnection(
  targetHandleId: string,
  sourceType: string,
  isVisualPicker: (t: string) => boolean,
): boolean {
  switch (targetHandleId) {
    case "prompt":
      return ACCEPTS_PROMPT(sourceType, isVisualPicker)
    case "ref-audio":
      return ACCEPTS_AUDIO_OR_DYN(sourceType)
    case "audio-style":
      return AUDIO_PICKER_TYPES.has(sourceType)
    default:
      return false
  }
}

/** audio-isolation: audio (audio producers). */
export function isValidAudioIsolationConnection(
  targetHandleId: string,
  sourceType: string,
): boolean {
  switch (targetHandleId) {
    case "audio":
      return ACCEPTS_AUDIO_OR_DYN(sourceType)
    default:
      return false
  }
}

/** text-to-dialogue: prompt (text + picker). */
export function isValidTextToDialogueConnection(
  targetHandleId: string,
  sourceType: string,
  isVisualPicker: (t: string) => boolean,
): boolean {
  switch (targetHandleId) {
    case "prompt":
      return ACCEPTS_PROMPT(sourceType, isVisualPicker)
    default:
      return false
  }
}

/** voice-changer: audio (audio producers). Pre-migration this node had
 *  only the legacy `in` target; it has no runtime consumer for a separate
 *  voice-persona pip (execute-node reads `data.voiceId` from the config
 *  panel), so adding a `voice` target would be a UI-only construct that
 *  doesn't route through to the worker. */
export function isValidVoiceChangerConnection(
  targetHandleId: string,
  sourceType: string,
): boolean {
  switch (targetHandleId) {
    case "audio":
      return ACCEPTS_AUDIO_OR_DYN(sourceType)
    default:
      return false
  }
}

/** dubbing: audio (audio + video producers — backend extracts audio from
 *  video inputs natively). */
export function isValidDubbingConnection(
  targetHandleId: string,
  sourceType: string,
): boolean {
  switch (targetHandleId) {
    case "audio":
      return ACCEPTS_AUDIO_OR_DYN(sourceType) || ACCEPTS_VIDEO_OR_DYN(sourceType)
    default:
      return false
  }
}

/** voice-remix: audio (audio producers), audio-style (audio pickers +
 *  voice-persona refs). Keeps the legacy `audio-style` handle id intact
 *  because runtime consumers (`audio-style-hints.ts`,
 *  `sound-aggregator.ts`, `connected-audio-sources.tsx`) filter by that
 *  literal string. */
export function isValidVoiceRemixConnection(
  targetHandleId: string,
  sourceType: string,
): boolean {
  switch (targetHandleId) {
    case "audio":
      return ACCEPTS_AUDIO_OR_DYN(sourceType)
    case "audio-style":
      return isAudioStyleSource(sourceType)
    default:
      return false
  }
}

/** voice-design: prompt (text + picker), audio-style (audio pickers +
 *  voice-persona refs — same as voice-remix). */
export function isValidVoiceDesignConnection(
  targetHandleId: string,
  sourceType: string,
  isVisualPicker: (t: string) => boolean,
): boolean {
  switch (targetHandleId) {
    case "prompt":
      return ACCEPTS_PROMPT(sourceType, isVisualPicker)
    case "audio-style":
      return isAudioStyleSource(sourceType)
    default:
      return false
  }
}

/** forced-alignment: audio (audio producers), transcript (text producers). */
export function isValidForcedAlignmentConnection(
  targetHandleId: string,
  sourceType: string,
): boolean {
  switch (targetHandleId) {
    case "audio":
      return ACCEPTS_AUDIO_OR_DYN(sourceType)
    case "transcript":
      return ACCEPTS_TEXT_OR_DYN(sourceType)
    default:
      return false
  }
}

// ─── Batch 2: AI > Suno Music ─────────────────────────────────────────

/** suno-voice: no targets (parameter-style node — its source emits a
 *  voice-persona ref to suno-generate's `voice` slot). Exported so the
 *  validator switch has a homogeneous shape, but always returns false. */
export function isValidSunoVoiceConnection(): boolean {
  return false
}

/** suno-generate: prompt (text + picker), audio-style (audio pickers),
 *  voice (voice-persona refs). VOICE_PERSONA_TYPES already includes
 *  voice-character. */
export function isValidSunoGenerateConnection(
  targetHandleId: string,
  sourceType: string,
  isVisualPicker: (t: string) => boolean,
): boolean {
  switch (targetHandleId) {
    case "prompt":
      return ACCEPTS_PROMPT(sourceType, isVisualPicker)
    case "audio-style":
      return AUDIO_PICKER_TYPES.has(sourceType)
    case "voice":
      return VOICE_PERSONA_TYPES.has(sourceType)
    default:
      return false
  }
}

/** suno-cover: audio (audio producers — special-cased to also accept
 *  youtube-video, mirroring the backend resolver's downloadedAudioUrl
 *  routing in input-resolver.ts:1287), prompt (text), voice (voice-persona
 *  refs — backend routes suno-voice → personaId for suno-cover). */
export function isValidSunoCoverConnection(
  targetHandleId: string,
  sourceType: string,
  isVisualPicker: (t: string) => boolean,
): boolean {
  switch (targetHandleId) {
    case "audio":
      return ACCEPTS_AUDIO_OR_DYN(sourceType) || sourceType === "youtube-video"
    case "prompt":
      return ACCEPTS_PROMPT(sourceType, isVisualPicker)
    case "voice":
      return VOICE_PERSONA_TYPES.has(sourceType)
    default:
      return false
  }
}

/** suno-extend: audio (audio producers), prompt (text), voice
 *  (voice-persona refs — backend routes suno-voice → personaId). */
export function isValidSunoExtendConnection(
  targetHandleId: string,
  sourceType: string,
  isVisualPicker: (t: string) => boolean,
): boolean {
  switch (targetHandleId) {
    case "audio":
      return ACCEPTS_AUDIO_OR_DYN(sourceType)
    case "prompt":
      return ACCEPTS_PROMPT(sourceType, isVisualPicker)
    case "voice":
      return VOICE_PERSONA_TYPES.has(sourceType)
    default:
      return false
  }
}

/** suno-lyrics: prompt (text + picker). */
export function isValidSunoLyricsConnection(
  targetHandleId: string,
  sourceType: string,
  isVisualPicker: (t: string) => boolean,
): boolean {
  switch (targetHandleId) {
    case "prompt":
      return ACCEPTS_PROMPT(sourceType, isVisualPicker)
    default:
      return false
  }
}

/** suno-separate: audio (audio producers — Suno-only at runtime, but the
 *  type-level check accepts any audio source; the worker rejects non-Suno
 *  with a clear error). */
export function isValidSunoSeparateConnection(
  targetHandleId: string,
  sourceType: string,
): boolean {
  switch (targetHandleId) {
    case "audio":
      return ACCEPTS_AUDIO_OR_DYN(sourceType)
    default:
      return false
  }
}

/** suno-music-video: audio (audio producers). */
export function isValidSunoMusicVideoConnection(
  targetHandleId: string,
  sourceType: string,
): boolean {
  switch (targetHandleId) {
    case "audio":
      return ACCEPTS_AUDIO_OR_DYN(sourceType)
    default:
      return false
  }
}

/** suno-mashup: audio1 + audio2 (both audio producers, order-matters). */
export function isValidSunoMashupConnection(
  targetHandleId: string,
  sourceType: string,
): boolean {
  switch (targetHandleId) {
    case "audio1":
    case "audio2":
      return ACCEPTS_AUDIO_OR_DYN(sourceType)
    default:
      return false
  }
}

/** suno-replace-section: audio + prompt. */
export function isValidSunoReplaceSectionConnection(
  targetHandleId: string,
  sourceType: string,
  isVisualPicker: (t: string) => boolean,
): boolean {
  switch (targetHandleId) {
    case "audio":
      return ACCEPTS_AUDIO_OR_DYN(sourceType)
    case "prompt":
      return ACCEPTS_PROMPT(sourceType, isVisualPicker)
    default:
      return false
  }
}

/** suno-style-boost: prompt (text + picker). */
export function isValidSunoStyleBoostConnection(
  targetHandleId: string,
  sourceType: string,
  isVisualPicker: (t: string) => boolean,
): boolean {
  switch (targetHandleId) {
    case "prompt":
      return ACCEPTS_PROMPT(sourceType, isVisualPicker)
    default:
      return false
  }
}

/** suno-add-instrumental: audio (audio producers — Suno track with vocals only). */
export function isValidSunoAddInstrumentalConnection(
  targetHandleId: string,
  sourceType: string,
): boolean {
  switch (targetHandleId) {
    case "audio":
      return ACCEPTS_AUDIO_OR_DYN(sourceType)
    default:
      return false
  }
}

/** suno-add-vocals: audio (audio producers — Suno track with instrumental only). */
export function isValidSunoAddVocalsConnection(
  targetHandleId: string,
  sourceType: string,
): boolean {
  switch (targetHandleId) {
    case "audio":
      return ACCEPTS_AUDIO_OR_DYN(sourceType)
    default:
      return false
  }
}

/** suno-convert-wav: audio (Suno track). */
export function isValidSunoConvertWavConnection(
  targetHandleId: string,
  sourceType: string,
): boolean {
  switch (targetHandleId) {
    case "audio":
      return ACCEPTS_AUDIO_OR_DYN(sourceType)
    default:
      return false
  }
}

/** suno-upload-extend: audio + prompt. (No `voice` target: the backend
 *  payload-builder for this node doesn't wire personaId — see
 *  payload-builder.ts:2924 — so a voice pip would be a UI-only construct.) */
export function isValidSunoUploadExtendConnection(
  targetHandleId: string,
  sourceType: string,
  isVisualPicker: (t: string) => boolean,
): boolean {
  switch (targetHandleId) {
    case "audio":
      return ACCEPTS_AUDIO_OR_DYN(sourceType)
    case "prompt":
      return ACCEPTS_PROMPT(sourceType, isVisualPicker)
    default:
      return false
  }
}

// ─── Batch 3: AI > Script & Text ──────────────────────────────────────

/** generate-script: prompt (text + picker). 7 source handles emit
 *  structured content; this validator only governs the input. */
export function isValidGenerateScriptConnection(
  targetHandleId: string,
  sourceType: string,
  isVisualPicker: (t: string) => boolean,
): boolean {
  switch (targetHandleId) {
    case "prompt":
      return ACCEPTS_PROMPT(sourceType, isVisualPicker)
    default:
      return false
  }
}

/** llm-chat: prompt (text + picker), references (any media OR text producer +
 *  extract-frame + generate-mask — node-input-resolver.ts:1200-1223 routes
 *  image/video/audio by source-kind into referenceImageUrls /
 *  referenceVideoUrls / referenceAudioUrls, and text producers fall through
 *  into the prompt as added context), system-prompt (text only — no pickers,
 *  system messages are full-prompt context not value substitution). */
export function isValidLlmChatConnection(
  targetHandleId: string,
  sourceType: string,
  isVisualPicker: (t: string) => boolean,
): boolean {
  switch (targetHandleId) {
    case "prompt":
      return ACCEPTS_PROMPT(sourceType, isVisualPicker)
    case "references":
      // Multimodal: accepts every media kind AND text — image, video, audio,
      // text producers, plus the frame/mask extractors. Text references are
      // merged into the prompt as added context by the resolver.
      return (
        IMAGE_PRODUCER_TYPES.has(sourceType) ||
        ACCEPTS_VIDEO_OR_DYN(sourceType) ||
        ACCEPTS_AUDIO_OR_DYN(sourceType) ||
        ACCEPTS_TEXT_OR_DYN(sourceType) ||
        sourceType === "extract-frame" ||
        sourceType === "generate-mask"
      )
    case "system-prompt":
      return ACCEPTS_TEXT_OR_DYN(sourceType)
    default:
      return false
  }
}

/** transcribe: audio (audio + video producers — backend extracts audio
 *  from a video input transparently). */
export function isValidTranscribeConnection(
  targetHandleId: string,
  sourceType: string,
): boolean {
  switch (targetHandleId) {
    case "audio":
      return ACCEPTS_AUDIO_OR_DYN(sourceType) || ACCEPTS_VIDEO_OR_DYN(sourceType)
    default:
      return false
  }
}

// ─── Batch 4: Processing > Audio + Text ───────────────────────────────
//
// NOTE: merge-video-audio, trim-audio, mix-audio, combine-audio, and
// adjust-volume are owned by `ffmpeg-handles.ts` (shipped in #2809) — they
// share the same handle taxonomy as combine-videos/extract-frame/etc. and
// are routed through `isValidFfmpegConnection`. Do not duplicate them here.

/** split-media: video (video-producers), audio (audio-producers). */
export function isValidSplitMediaConnection(
  targetHandleId: string,
  sourceType: string,
): boolean {
  switch (targetHandleId) {
    case "video":
      return ACCEPTS_VIDEO_OR_DYN(sourceType)
    case "audio":
      return ACCEPTS_AUDIO_OR_DYN(sourceType)
    default:
      return false
  }
}

/** combine-text: text (text-producers, multi-edge, order-matters —
 *  joined by separator in edge-array order). Pickers also accepted as
 *  text-fragment producers. */
export function isValidCombineTextConnection(
  targetHandleId: string,
  sourceType: string,
  isVisualPicker: (t: string) => boolean,
): boolean {
  switch (targetHandleId) {
    case "text":
      return ACCEPTS_PROMPT(sourceType, isVisualPicker)
    default:
      return false
  }
}

/** split-text: text (text-producers only — pickers don't apply since the
 *  node just splits a single string). */
export function isValidSplitTextConnection(
  targetHandleId: string,
  sourceType: string,
): boolean {
  switch (targetHandleId) {
    case "text":
      return ACCEPTS_TEXT_OR_DYN(sourceType)
    default:
      return false
  }
}

/** preview: accepts ANY source — neutral inspection node. The popover
 *  shows every node type as a valid candidate. */
export function isValidPreviewConnection(
  targetHandleId: string,
): boolean {
  switch (targetHandleId) {
    case "in":
      return true
    default:
      return false
  }
}

// ─── Friendly labels for source-direction popover candidate rows ──────

/** Per-node-type, per-handle-id label table. Source-direction popovers
 *  enumerate target-handle candidates via target-handle-registry, and each
 *  candidate row shows a "→ <handle label>" chip. Defaulting to the raw
 *  handleId works but reads awkwardly ("→ ref-audio"); explicit labels
 *  read better ("→ Ref audio"). */
export const AUDIO_TEXT_HANDLE_LABELS: Record<string, Record<string, string>> = {
  "text-to-speech":     { prompt: "Prompt" },
  "text-to-audio":      { prompt: "Prompt", "audio-style": "Audio style" },
  "generate-music":     { prompt: "Prompt", "ref-audio": "Ref audio", "audio-style": "Audio style" },
  "audio-isolation":    { audio: "Audio" },
  "text-to-dialogue":   { prompt: "Prompt" },
  "voice-changer":      { audio: "Audio" },
  "dubbing":            { audio: "Audio" },
  "voice-remix":        { audio: "Audio", "audio-style": "Audio style" },
  "voice-design":       { prompt: "Prompt", "audio-style": "Audio style" },
  "forced-alignment":   { audio: "Audio", transcript: "Transcript" },
  // Batch 2: Suno Music
  "suno-generate":          { prompt: "Prompt", "audio-style": "Audio style", voice: "Voice" },
  "suno-cover":             { audio: "Audio", prompt: "Prompt", voice: "Voice" },
  "suno-extend":            { audio: "Audio", prompt: "Prompt", voice: "Voice" },
  "suno-lyrics":            { prompt: "Prompt" },
  "suno-separate":          { audio: "Audio" },
  "suno-music-video":       { audio: "Audio" },
  "suno-mashup":            { audio1: "Audio 1", audio2: "Audio 2" },
  "suno-replace-section":   { audio: "Audio", prompt: "Prompt" },
  "suno-style-boost":       { prompt: "Prompt" },
  "suno-add-instrumental":  { audio: "Audio" },
  "suno-add-vocals":        { audio: "Audio" },
  "suno-convert-wav":       { audio: "Audio" },
  "suno-upload-extend":     { audio: "Audio", prompt: "Prompt" },
  // Batch 3: AI > Script & Text
  "generate-script":    { prompt: "Prompt" },
  "llm-chat":           { prompt: "Prompt", references: "References", "system-prompt": "Instructions" },
  "transcribe":         { audio: "Audio" },
  // Batch 4: Processing > Audio + Text
  // (merge-video-audio, trim-audio, mix-audio, combine-audio, adjust-volume
  //  live in ffmpeg-handles.ts — see note above.)
  "split-media":        { video: "Video", audio: "Audio" },
  "combine-text":       { text: "Text" },
  "split-text":         { text: "Text" },
  "preview":            { in: "Input" },
}
