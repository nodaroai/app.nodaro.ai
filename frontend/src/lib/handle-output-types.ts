/**
 * Authoritative `(nodeType, sourceHandleId) -> data-type` registry for every
 * NON-picker node that renders a typed output pip. This is the single source
 * of truth the edge-color resolver reads so an idle wire matches the source
 * pip it leaves (text wires blue, image cyan, video violet, …) — including
 * the cases a handle-id-alone guess can't disambiguate (`out` means a list on
 * sort-list, a control signal on reduce, an approval on save-to-storage).
 *
 * Each value is a key of HANDLE_COLORS; the resolver maps it through that map,
 * so the edge can never drift from the pip's own color.
 *
 * MAINTENANCE: this map is mechanically derived from the actual
 * `color={HANDLE_COLORS.x}` props on `type="source"` handles in
 * `components/nodes/*.tsx`. The drift guard in
 * `components/nodes/__tests__/handle-color-guard.test.ts` re-extracts those
 * props and fails if this map disagrees, is missing a static output handle,
 * or carries a stale entry — so it stays correct by construction rather than
 * by remembering to update a list. Do not hand-edit to diverge from the JSX;
 * change the pip color and let the guard tell you what to update here.
 *
 * Pickers (camera-motion, person, text-prompt, …) are intentionally absent:
 * their output color is the picker family color, resolved earlier via
 * `getPickerOutputMeta`. Genuinely runtime-typed outputs (sub-workflow ports,
 * router routes, social-media-format `media`, extract-field `out`, list
 * columns) are absent too — their type isn't knowable without node data, so
 * the resolver leaves those wires neutral.
 */
import type { HandleColorType } from "./handle-colors"

export const HANDLE_OUTPUT_TYPES: Record<string, Partial<Record<string, HandleColorType>>> = {
  "3d-title": { composition: "control" },
  "ai-avatar": { video: "video" },
  "add-captions": { "video-out": "video" },
  "adjust-volume": { "video-out": "video", "audio-out": "audio" },
  "after-effects": { composition: "control" },
  "audio-isolation": { audio: "audio" },
  "character": { characterRef: "identity" },
  "cinematic-avatar": { video: "video" },
  "combine-audio": { "audio-out": "audio" },
  "combine-text": { text: "text" },
  "combine-videos": { video: "video" },
  "composite": { composition: "control" },
  "deduplicate": { out: "list" },
  "dubbing": { audio: "audio" },
  "edit-image": { image: "image" },
  "extend-video": { video: "video" },
  "extract-audio": { audio: "audio" },
  "extract-frame": { image: "image" },
  "face": { faceRef: "face" },
  "face-swap": { video: "video" },
  "fade-video": { video: "video" },
  "filter-list": { out: "list" },
  "forced-alignment": { data: "look" },
  "generate-image": { image: "image" },
  "generate-mask": { image: "image", mask: "mask" },
  "generate-music": { audio: "audio" },
  "generate-script": { scenes: "video", images: "image", dialogue: "text", music: "audio", sfx: "audio", characters: "identity", locations: "identity" },
  "generate-video": { video: "video" },
  "generative-pipeline": { final_video: "video" },
  "image-critic": { approved: "approve", rejected: "negative" },
  "image-to-image": { image: "image" },
  "image-to-text": { text: "text" },
  "json-process": { out: "control" },
  "lip-sync": { video: "video" },
  "llm-chat": { text: "text", items: "list" },
  "location": { locationRef: "image" },
  "loop-video": { "video-out": "video" },
  "lottie-overlay": { composition: "control" },
  "manual-edit": { video: "video" },
  "merge-lists": { out: "list" },
  "merge-video-audio": { "video-out": "video" },
  "mix-audio": { "audio-out": "audio" },
  "modify-image": { image: "image" },
  "motion-graphics": { composition: "control" },
  "motion-transfer": { video: "video" },
  "object": { objectRef: "imageRef" },
  "preview": { out: "control" },
  "qa-check": { approved: "approve", rejected: "negative" },
  "reduce": { out: "control" },
  "reference-audio": { audio: "audio" },
  "reference-sheet": { sheet: "image", panels: "reference" },
  "remove-audio": { "video-out": "video" },
  "remove-background": { image: "image" },
  "render-video": { video: "video" },
  "resize-video": { "video-out": "video" },
  "save-to-storage": { out: "approve" },
  "schedule-trigger": { payload: "control" },
  "selector": { picked: "list", rest: "list" },
  "social-media-format": { text: "text" },
  "sort-list": { out: "list" },
  "speech-to-video": { video: "video" },
  "speed-ramp": { video: "video" },
  "split-media": { video: "video", audio: "audio" },
  "split-text": { text: "text" },
  "sub-workflow-output": { out: "control" },
  "suno-add-instrumental": { audio: "audio" },
  "suno-add-vocals": { audio: "audio" },
  "suno-convert-wav": { audio: "audio" },
  "suno-cover": { audio: "audio" },
  "suno-extend": { audio: "audio" },
  "suno-generate": { audio: "audio" },
  "suno-lyrics": { text: "text" },
  "suno-mashup": { audio: "audio" },
  "suno-music-video": { video: "video" },
  "suno-replace-section": { audio: "audio" },
  "suno-separate": { vocals: "audio", instrumental: "audio" },
  "suno-style-boost": { text: "text" },
  "suno-upload-extend": { audio: "audio" },
  "suno-voice": { voicePersona: "identity" },
  "telegram-trigger": { out: "control" },
  "text-to-audio": { audio: "audio" },
  "text-to-dialogue": { audio: "audio" },
  "text-to-speech": { audio: "audio" },
  "transcode-video": { video: "video" },
  "transcribe": { text: "text" },
  "trim-audio": { audio: "audio" },
  "trim-video": { "video-out": "video" },
  "upload-audio": { audio: "audio" },
  "upload-image": { image: "image" },
  "upload-video": { video: "video" },
  "upscale-image": { image: "image" },
  "video-composer": { composition: "control" },
  "video-retake": { video: "video" },
  "video-sfx": { video: "video" },
  "video-to-video": { video: "video" },
  "video-upscale": { video: "video" },
  "voice-changer": { audio: "audio", video: "video" },
  "voice-design": { audio: "audio", voiceId: "identity" },
  "voice-remix": { audio: "audio" },
  "web-scrape": { json: "look" },
  "webhook-output": { out: "approve" },
  "youtube-video": { video: "video" },
}
