import path from "node:path"
import { fileURLToPath } from "node:url"
import { loadUnits } from "../../../../tools/units/manifest.mjs"

/**
 * Best-effort node-type → MCP tool name map. Unmapped node types omit the
 * mcp-call block (renderMcpCallBlock returns "" when the schema is
 * undefined). Extend as new 1:1 mappings appear.
 *
 * Shared by gen-skills (the mcp-call block of each node skill) and the
 * surface checker (scripts/check-surfaces.ts, the MCP column of a node).
 *
 * The hand-written rows ∪ every node unit that names its verb in its manifest
 * (unit.json `mcp.widgetModelFor`, the MCP tool that dispatches its type): a
 * unit is never named here. A unit naming several verbs gets no row (which of
 * them is "the" tool is not something the manifest says).
 */
const LEGACY_NODE_TYPE_TO_TOOL: Readonly<Record<string, string>> = {
  "generate-image": "generate_image",
  "image-to-image": "image_to_image",
  "image-to-video": "animate_image",
  "text-to-video": "generate_video",
  "generate-video": "generate_video",
  "generate-music": "generate_music",
  "text-to-speech": "generate_speech",
  "text-to-audio": "text_to_audio",
  "trim-video": "trim_video",
  "combine-videos": "combine_videos",
  "merge-video-audio": "merge_video_audio",
  "lip-sync": "lip_sync",
  "voice-design": "voice_design",
  "voice-changer": "voice_changer",
  "voice-remix": "voice_remix",
  "edit-image": "edit_image",
  "modify-image": "modify_image",
  "modify-video": "modify_video",
  "video-to-video": "modify_video",
  "extract-frame": "extract_frame",
  "video-upscale": "video_upscale",
  "video-depth": "video_depth",
  "extend-video": "extend_video",
  "loop-video": "loop_video",
  "motion-transfer": "motion_transfer",
  "face-swap": "face_swap",
  "speech-to-video": "speech_to_video",
  "generate-character": "generate_character",
  "generate-location": "generate_location",
  "generate-object": "generate_object",
  "generate-mask": "generate_mask",
  "generate-script": "generate_script",
  "generate-3d-scene": "generate_3d_scene",
  "edit-3d-scene": "edit_3d_scene",
  "transcribe": "transcribe",
  "dubbing": "dubbing",
  "audio-isolation": "audio_isolation",
  "trim-audio": "trim_audio",
  "split-media": "split_media",
  "add-captions": "add_captions",
  "image-to-text": "image_to_text",
  "suno-generate": "suno_generate",
  "suno-extend": "suno_extend",
  "suno-cover": "suno_cover",
  "suno-mashup": "suno_mashup",
  "suno-lyrics": "suno_lyrics",
  "suno-add-vocals": "suno_add_vocals",
  "suno-add-instrumental": "suno_add_instrumental",
  "suno-replace-section": "suno_replace_section",
  "suno-style-boost": "suno_style_boost",
  "suno-music-video": "suno_music_video",
  "suno-convert-wav": "suno_convert_wav",
  "suno-upload-extend": "suno_upload_extend",
  "suno-separate": "suno_separate_stems",
  "video-overlay": "overlay_images",
}

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..")

/** The [type, tool] rows of the node units in `root` that name exactly one MCP verb. */
export function unitNodeTools(root: string): Array<[type: string, tool: string]> {
  return loadUnits(root).flatMap((u) => {
    const tools = (u.manifest as { mcp?: { widgetModelFor?: unknown } } | null)?.mcp?.widgetModelFor
    return Array.isArray(tools) && tools.length === 1 && typeof tools[0] === "string" ? [[u.type, tools[0]] as [string, string]] : []
  })
}

function composeNodeTools(): Readonly<Record<string, string>> {
  const out: Record<string, string> = { ...LEGACY_NODE_TYPE_TO_TOOL }
  for (const [type, tool] of unitNodeTools(REPO_ROOT)) {
    if (Object.hasOwn(out, type)) throw new Error(`NODE_TYPE_TO_TOOL: "${type}" is both a hand-written row and a node unit — drop the row`)
    out[type] = tool
  }
  return out
}

export const NODE_TYPE_TO_TOOL: Readonly<Record<string, string>> = composeNodeTools()
