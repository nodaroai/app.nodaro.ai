import type { FactoryPreset } from "./types.js"
import { stylizedSubjectFor, editsFor } from "./shared-image.js"
import { GENERATE_IMAGE_PRESETS } from "./generate-image.js"
import { GENERATE_VIDEO_PRESETS } from "./generate-video.js"
import { GENERATE_MUSIC_PRESETS, SUNO_GENERATE_PRESETS } from "./music.js"
import { TEXT_TO_SPEECH_PRESETS, VOICE_DESIGN_PRESETS, VOICE_CHANGER_PRESETS } from "./voice.js"
import { TEXT_TO_AUDIO_PRESETS } from "./sfx.js"
import { LLM_CHAT_PRESETS, GENERATE_SCRIPT_PRESETS, IMAGE_TO_TEXT_PRESETS } from "./text.js"
import { VIDEO_TO_VIDEO_PRESETS, ADD_CAPTIONS_PRESETS, COMBINE_VIDEOS_PRESETS } from "./video-edit.js"

export type { FactoryPreset, FactoryPresetGroup } from "./types.js"
export { groupFactoryPresets } from "./types.js"

/** System/factory presets shipped with the app. Assembled here in the original
 *  single-file key order; each value lives in its per-domain module. */
export const FACTORY_PRESETS: Readonly<Record<string, readonly FactoryPreset[]>> = {
  "generate-image": GENERATE_IMAGE_PRESETS,

  // modify-image shares the Stylized Subject + Edits catalogs with generate-image
  // (single source of truth in STYLIZED_SUBJECT / IMAGE_EDITS). modify-image is
  // slated for deprecation in favor of generate-image — when removed, drop this key.
  "modify-image": [...stylizedSubjectFor("modify-image"), ...editsFor("modify-image")],
  "generate-video": GENERATE_VIDEO_PRESETS,
  "text-to-speech": TEXT_TO_SPEECH_PRESETS,
  "text-to-audio": TEXT_TO_AUDIO_PRESETS,
  "generate-music": GENERATE_MUSIC_PRESETS,
  "suno-generate": SUNO_GENERATE_PRESETS,
  "llm-chat": LLM_CHAT_PRESETS,
  "generate-script": GENERATE_SCRIPT_PRESETS,
  "image-to-text": IMAGE_TO_TEXT_PRESETS,
  "voice-design": VOICE_DESIGN_PRESETS,
  "video-to-video": VIDEO_TO_VIDEO_PRESETS,
  "voice-changer": VOICE_CHANGER_PRESETS,
  "add-captions": ADD_CAPTIONS_PRESETS,
  "combine-videos": COMBINE_VIDEOS_PRESETS,
}

export function getFactoryPresets(nodeType: string): readonly FactoryPreset[] {
  return FACTORY_PRESETS[nodeType] ?? []
}
