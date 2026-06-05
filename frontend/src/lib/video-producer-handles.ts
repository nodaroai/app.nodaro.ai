/**
 * Per-node typed-handle predicates for video-producer nodes:
 * video-to-video, video-upscale, extend-video, lip-sync, speech-to-video,
 * motion-transfer.
 *
 * Each `isValid<Node>Connection(targetHandleId, sourceType, isPickerType)`
 * returns true iff a source node type is allowed on the given target
 * handle. The same predicates are called from `connection-validation.ts`
 * (drag-to-connect) AND `HandlePopover` (one-click Connect button), so
 * routing and visual-candidate highlight always agree.
 *
 * Convention mirrors `image-producer-handles.ts` (Phase 20): every typed
 * image/video/audio/text target handle OR's in `DYNAMIC_PRODUCER_TYPES`
 * (loop / list / sub-workflow / reduce / adjust-volume) — without that
 * escape hatch, the canvas validator hard-rejects edges the backend
 * resolver would happily route at runtime (drift fix from #2823 / #2827).
 */
import { VIDEO_PRODUCER_TYPES, AUDIO_PRODUCER_TYPES, DYNAMIC_PRODUCER_TYPES } from "@nodaro/shared"
import { TEXT_PRODUCER_TYPES, IMAGE_PRODUCER_TYPES, IDENTITY_TYPES } from "./generate-image-handles"

const ACCEPTS_IMAGE_OR_DYN = (s: string): boolean =>
  IMAGE_PRODUCER_TYPES.has(s) || DYNAMIC_PRODUCER_TYPES.has(s)
const ACCEPTS_VIDEO_OR_DYN = (s: string): boolean =>
  VIDEO_PRODUCER_TYPES.has(s) || DYNAMIC_PRODUCER_TYPES.has(s)
const ACCEPTS_AUDIO_OR_DYN = (s: string): boolean =>
  AUDIO_PRODUCER_TYPES.has(s) || DYNAMIC_PRODUCER_TYPES.has(s)
const ACCEPTS_TEXT_OR_DYN = (s: string): boolean =>
  TEXT_PRODUCER_TYPES.has(s) || DYNAMIC_PRODUCER_TYPES.has(s)

/** Convenience predicate combining text producers + pickers + dynamic
 *  producers — every `prompt` slot accepts this exact union. Same shape
 *  as audio-text-handles.ts:ACCEPTS_PROMPT. */
const ACCEPTS_PROMPT = (
  sourceType: string,
  isVisualPicker: (t: string) => boolean,
): boolean =>
  ACCEPTS_TEXT_OR_DYN(sourceType) || isVisualPicker(sourceType)

/** Legacy `cinematography` target accepts any visual picker (matches
 *  getCompatibleNodes' cinematography branch). The v2.1 generate-image
 *  split this into look + elements, but these nodes still use the single
 *  combined handle for backwards compat. */
const ACCEPTS_CINEMATOGRAPHY = (
  sourceType: string,
  isVisualPicker: (t: string) => boolean,
): boolean => isVisualPicker(sourceType)

// ─── video-to-video ────────────────────────────────────────────────────
// Inputs: video, cinematography, prompt, negative (text-only).
// Source: video (already correct).
export function isValidVideoToVideoConnection(
  targetHandleId: string,
  sourceType: string,
  isVisualPicker: (t: string) => boolean,
): boolean {
  switch (targetHandleId) {
    case "video":
      return ACCEPTS_VIDEO_OR_DYN(sourceType)
    case "cinematography":
      return ACCEPTS_CINEMATOGRAPHY(sourceType, isVisualPicker)
    case "prompt":
      return ACCEPTS_PROMPT(sourceType, isVisualPicker)
    case "negative":
      return ACCEPTS_TEXT_OR_DYN(sourceType)
    default:
      return false
  }
}

// ─── video-upscale ─────────────────────────────────────────────────────
// Single video input. Source: video (already correct).
export function isValidVideoUpscaleConnection(
  targetHandleId: string,
  sourceType: string,
): boolean {
  switch (targetHandleId) {
    case "video":
      return ACCEPTS_VIDEO_OR_DYN(sourceType)
    default:
      return false
  }
}

// ─── extend-video ──────────────────────────────────────────────────────
// Inputs: video, cinematography, prompt. Source: video (already correct).
// (extend-video worker doesn't read negativePrompt — no `negative` handle.)
export function isValidExtendVideoConnection(
  targetHandleId: string,
  sourceType: string,
  isVisualPicker: (t: string) => boolean,
): boolean {
  switch (targetHandleId) {
    case "video":
      return ACCEPTS_VIDEO_OR_DYN(sourceType)
    case "cinematography":
      return ACCEPTS_CINEMATOGRAPHY(sourceType, isVisualPicker)
    case "prompt":
      return ACCEPTS_PROMPT(sourceType, isVisualPicker)
    default:
      return false
  }
}

// ─── lip-sync ──────────────────────────────────────────────────────────
// Inputs: image (portrait), video (video-input providers), audio. Source: video.
// All three input pips are conditionally rendered in the node based on
// provider capability, but the predicate accepts them unconditionally —
// matches modify-image's mask-handle pattern (a saved connection stays
// valid if the user later flips providers).
export function isValidLipSyncConnection(
  targetHandleId: string,
  sourceType: string,
): boolean {
  switch (targetHandleId) {
    case "image":
      return ACCEPTS_IMAGE_OR_DYN(sourceType)
    case "video":
      return ACCEPTS_VIDEO_OR_DYN(sourceType)
    case "audio":
      return ACCEPTS_AUDIO_OR_DYN(sourceType)
    default:
      return false
  }
}

// ─── speech-to-video ───────────────────────────────────────────────────
// Inputs: cinematography, image (portrait), audio, prompt (text or picker).
// Source: video.
export function isValidSpeechToVideoConnection(
  targetHandleId: string,
  sourceType: string,
  isVisualPicker: (t: string) => boolean,
): boolean {
  switch (targetHandleId) {
    case "image":
      return ACCEPTS_IMAGE_OR_DYN(sourceType)
    case "audio":
      return ACCEPTS_AUDIO_OR_DYN(sourceType)
    case "prompt":
      return ACCEPTS_PROMPT(sourceType, isVisualPicker)
    case "cinematography":
      return ACCEPTS_CINEMATOGRAPHY(sourceType, isVisualPicker)
    default:
      return false
  }
}

// ─── ai-avatar ─────────────────────────────────────────────────────────
// Inputs: image (image-source mode), script (verbatim text, text mode),
// audio (audio-driven mode). Source: video.
//
// All handles are ALWAYS mounted (voice-changer pattern). The `script`
// handle is intentionally restricted to text producers — parameter-picker
// prose or cinematography hints must NOT leak into the verbatim TTS field.
// The `audio` handle mirrors lip-sync / speech-to-video (audio + dynamic).
// The `image` handle accepts image producers (image-source mode) — mirrors
// lip-sync's portrait handle.
export function isValidAiAvatarConnection(
  targetHandleId: string,
  sourceType: string,
  isVisualPicker: (t: string) => boolean,
): boolean {
  switch (targetHandleId) {
    case "image":
      return ACCEPTS_IMAGE_OR_DYN(sourceType)
    case "script":
      // Text producers ONLY — no pickers, no dynamic producers.
      // Mirrors the text-to-speech `directText` precedent: verbatim spoken
      // script must not get parameter-picker prose or cinematography hints.
      return ACCEPTS_TEXT_OR_DYN(sourceType) && !isVisualPicker(sourceType)
    case "audio":
      return ACCEPTS_AUDIO_OR_DYN(sourceType)
    default:
      return false
  }
}

// ─── cinematic-avatar ──────────────────────────────────────────────────
// Input: prompt (a true GENERATIVE prompt, unlike ai-avatar's verbatim
// `script`). Source: video. Because the prompt is generative — not spoken
// verbatim — it accepts the same producers as any other prompt handle
// (text producers, parameter pickers, cinematography hints), mirroring
// motion-transfer / speech-to-video's `prompt` handle.
export function isValidCinematicAvatarConnection(
  targetHandleId: string,
  sourceType: string,
  isVisualPicker?: (t: string) => boolean,
): boolean {
  switch (targetHandleId) {
    case "prompt":
      return ACCEPTS_PROMPT(sourceType, isVisualPicker ?? (() => false))
    default:
      return false
  }
}

// ─── motion-transfer ───────────────────────────────────────────────────
// Inputs (bottom-up clusters mirroring generate-video):
//   Text:    prompt → negative
//   Image:   image → video    (character ref + motion source — both REQUIRED)
//   Pickers: assets            (character / face / object / location → imageUrl)
// Source: video (renamed from `out`).
//
// `negative` is text-only — pickers like `mood: cheerful` would invert the
// picker's intent if wired into negation. Matches generate-video.
export function isValidMotionTransferConnection(
  targetHandleId: string,
  sourceType: string,
  isVisualPicker?: (t: string) => boolean,
): boolean {
  switch (targetHandleId) {
    case "image":
      return ACCEPTS_IMAGE_OR_DYN(sourceType)
    case "video":
      return ACCEPTS_VIDEO_OR_DYN(sourceType)
    case "prompt":
      return ACCEPTS_PROMPT(sourceType, isVisualPicker ?? (() => false))
    case "negative":
      return ACCEPTS_TEXT_OR_DYN(sourceType)
    case "assets":
      return IDENTITY_TYPES.has(sourceType)
    default:
      return false
  }
}

// ─── Friendly labels for source-direction popover candidate rows ──────

export const VIDEO_PRODUCER_HANDLE_LABELS: Record<string, Record<string, string>> = {
  "video-to-video":   { video: "Video", cinematography: "Cinematography", prompt: "Prompt", negative: "Negative" },
  "video-upscale":    { video: "Video" },
  "extend-video":     { video: "Video", cinematography: "Cinematography", prompt: "Prompt" },
  "lip-sync":         { image: "Portrait", video: "Source video", audio: "Audio" },
  "speech-to-video":  { image: "Portrait", audio: "Audio", prompt: "Prompt", cinematography: "Cinematography" },
  "motion-transfer":  { image: "Character", video: "Source video", prompt: "Prompt", negative: "Negative", assets: "Assets" },
  "ai-avatar":        { image: "Image", script: "Script", audio: "Audio", video: "Video" },
  "cinematic-avatar": { prompt: "Prompt", video: "Video" },
}
