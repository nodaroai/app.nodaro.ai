// @registry-lookup asks unitDescriptorOf(type) only for the one type a share shows
/**
 * The name a share card gives the tool that made a result ("Lady's on the
 * Loose · Song Mashup"), and what kind of work it made (a song, a voice, a
 * sound effect…), which the card's description line is chosen by.
 *
 * A node unit names itself: its tool is its own label and its kind of work
 * its output's medium (its manifest, read through lib/unit-descriptors.ts).
 * Every other type is in one typed table keyed by the job's type
 * (`input_data.type`, else the `job_type` column, which the video worker
 * rewrites to its queue name). The names are plain words a person reads in a
 * chat preview, never a model's name. `__tests__/tool-names.test.ts` fails
 * when a node that makes an image, a video or a sound (the node registry), a
 * queue name the gallery lists, or a job type run outside the canvas has no
 * name, so a new tool cannot ship without one. A type neither knows (a private
 * plugin's) reads as its media kind, with no tool name.
 */
import { RENDER_NODE_TYPE_IDS } from "@nodaro/shared/nodes"
import { unitDescriptorOf } from "../unit-descriptors.js"
import type { SharedMediaKind } from "./types.js"

/** What a shared result is, as its card's description names it. */
export const SHARE_WORK_KINDS = ["image", "video", "song", "speech", "sound-effect", "audio"] as const
export type ShareWorkKind = (typeof SHARE_WORK_KINDS)[number]

export interface ShareTool {
  /** What a person calls the tool, in English (Title Case). */
  readonly name: string
  /** What it makes. A dual-mode tool (a voice changer run on a video) is read by the media it made. */
  readonly work: ShareWorkKind
}

const t = (name: string, work: ShareWorkKind): ShareTool => ({ name, work })

/** A render node's result is an edited video (the render registry names them; one below may name itself more closely). */
const RENDER_TOOLS: Readonly<Record<string, ShareTool>> = Object.fromEntries(RENDER_NODE_TYPE_IDS.map((type) => [type, t("Video Edit", "video")]))

export const SHARE_TOOLS: Readonly<Record<string, ShareTool>> = {
  ...RENDER_TOOLS,
  // Pictures
  "generate-image": t("Image Generation", "image"),
  "image-to-image": t("Image Edit", "image"),
  "edit-image": t("Image Edit", "image"),
  "image-edit": t("Image Edit", "image"),
  "modify-image": t("Image Edit", "image"),
  "upscale-image": t("Image Upscale", "image"),
  "remove-background": t("Background Removal", "image"),
  "site-capture": t("Site Capture", "image"),
  "ugc-creator": t("UGC Creator", "image"),
  "reference-sheet": t("Reference Sheet", "image"),
  "reference-board": t("Reference Board", "image"),
  "generate-mask": t("Mask", "image"),
  "paint-mask": t("Mask", "image"),
  "image-collage": t("Collage", "image"),
  "image-overlay": t("Image Overlay", "image"),
  "extract-frame": t("Video Frame", "image"),
  "generate-character": t("Character", "image"),
  "generate-character-asset": t("Character", "image"),
  "generate-object": t("Object", "image"),
  "generate-object-asset": t("Object", "image"),
  "generate-location": t("Location", "image"),
  "generate-location-asset": t("Location", "image"),
  // Videos
  "image-to-video": t("Image to Video", "video"),
  "text-to-video": t("Text to Video", "video"),
  "generate-video": t("Video Generation", "video"),
  "generate-video-pro": t("Video Generation", "video"),
  "edit-video-pro": t("Video Edit", "video"),
  "video-to-video": t("Video to Video", "video"),
  "video-retake": t("Video Retake", "video"),
  "cast-swap": t("Video Remake", "video"),
  "ugc-clip": t("UGC Clip", "video"),
  "ugc-finish-clips": t("UGC Video", "video"),
  "video-sfx": t("Video Sound Effects", "video"),
  "video-depth": t("Video Depth", "video"),
  "face-swap": t("Face Swap", "video"),
  "switchx": t("Relight", "video"),
  "lip-sync": t("Lip Sync", "video"),
  "speech-to-video": t("Speech to Video", "video"),
  "ai-avatar": t("AI Avatar", "video"),
  "cinematic-avatar": t("Cinematic Avatar", "video"),
  "motion-transfer": t("Motion Transfer", "video"),
  "video-upscale": t("Video Upscale", "video"),
  "extend-video": t("Video Extension", "video"),
  "suno-music-video": t("Music Video", "video"),
  "video-mask": t("Video Mask", "video"),
  "combine-videos": t("Video Edit", "video"),
  "manual-edit": t("Video Edit", "video"),
  "speaker-view": t("Speaker View", "video"),
  "assemble-narrated-video": t("Narrated Video", "video"),
  "video-overlay": t("Video Overlay", "video"),
  "merge-video-audio": t("Video with Sound", "video"),
  "replace-audio": t("Video with Sound", "video"),
  "still-to-video": t("Still to Video", "video"),
  "slideshow": t("Slideshow", "video"),
  "trim-video": t("Video Trim", "video"),
  "resize-video": t("Video Resize", "video"),
  "add-captions": t("Captions", "video"),
  "speed-ramp": t("Speed Change", "video"),
  "split-media": t("Video Chunks", "video"),
  "loop-video": t("Loop", "video"),
  "mask-composite": t("Mask Composite", "video"),
  "fade-video": t("Fade", "video"),
  "transcode-video": t("Video Conversion", "video"),
  "social-media-format": t("Social Video", "video"),
  "render-video": t("Video Render", "video"),
  "after-effects": t("Motion Design", "video"),
  "motion-graphics": t("Motion Graphics", "video"),
  "pro-3d-render": t("3D Render", "video"),
  "3d-title": t("3D Title", "video"),
  "video-composer": t("Video Composer", "video"),
  "lottie-overlay": t("Animated Overlay", "video"),
  "composite": t("Composite", "video"),
  "generative-pipeline": t("Story to Video", "video"),
  "scene": t("Scene", "video"),
  // Songs
  "generate-music": t("Music", "song"),
  "suno-generate": t("Song", "song"),
  "suno-cover": t("Song Cover", "song"),
  "suno-extend": t("Song Extension", "song"),
  "suno-upload-extend": t("Song Extension", "song"),
  "suno-mashup": t("Song Mashup", "song"),
  "suno-replace-section": t("Song Edit", "song"),
  "suno-add-instrumental": t("Instrumental", "song"),
  "suno-add-vocals": t("Vocals", "song"),
  "suno-convert-wav": t("Song", "song"),
  "suno-separate": t("Stems", "song"),
  // Voices
  "text-to-speech": t("Text to Speech", "speech"),
  "text-to-dialogue": t("Dialogue", "speech"),
  "voice-changer": t("Voice Changer", "speech"),
  "voice-changer-pro": t("Voice Changer", "speech"),
  "voice-remix": t("Voice Remix", "speech"),
  "voice-design": t("Voice Design", "speech"),
  "dubbing": t("Dubbing", "speech"),
  // Sound effects and other sound
  "text-to-audio": t("Sound Effect", "sound-effect"),
  "audio-fx": t("Audio Effects", "audio"),
  "audio-isolation": t("Audio Isolation", "audio"),
  "audio-separation": t("Audio Separation", "audio"),
  "trim-audio": t("Audio Trim", "audio"),
  "mix-audio": t("Audio Mix", "audio"),
  "combine-audio": t("Audio Edit", "audio"),
  "extract-audio": t("Audio Extraction", "audio"),
  "adjust-volume": t("Volume", "audio"),
  "pitch-tempo": t("Pitch & Tempo", "audio"),
}

/** The kinds of work that are sound, by the media kind each needs. */
const WORK_MEDIA: Readonly<Record<ShareWorkKind, SharedMediaKind>> = {
  image: "image",
  video: "video",
  song: "audio",
  speech: "audio",
  "sound-effect": "audio",
  audio: "audio",
}

const WORK_OF_MEDIA: Readonly<Record<SharedMediaKind, ShareWorkKind>> = { image: "image", video: "video", audio: "audio" }

/** The tool a node unit names itself: its label, and the medium it makes (null when it makes none). */
function unitTool(type: string): ShareTool | null {
  const unit = unitDescriptorOf(type)
  const media = unit?.producer ?? (unit && (unit.outputType === "image" || unit.outputType === "video" || unit.outputType === "audio") ? unit.outputType : null)
  if (!unit || !media || media === "dynamic") return unit ? { name: unit.label, work: "video" } : null
  return { name: unit.label, work: WORK_OF_MEDIA[media] }
}

/** The tool a shared result was made with (null for a type no one names). */
export function shareToolOf(type: string): ShareTool | null {
  if (Object.hasOwn(SHARE_TOOLS, type)) return SHARE_TOOLS[type]!
  return unitTool(type)
}

/**
 * What a shared result is: its tool's kind of work when that matches the media
 * the result is (a voice changer run on a video made a video), else its media.
 */
export function shareWorkOf(type: string, mediaKind: SharedMediaKind): ShareWorkKind {
  const tool = shareToolOf(type)
  return tool && WORK_MEDIA[tool.work] === mediaKind ? tool.work : WORK_OF_MEDIA[mediaKind]
}
