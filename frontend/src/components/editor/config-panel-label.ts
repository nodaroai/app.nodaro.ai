import type { LocaleId } from "@nodaro/shared"
import { localizeNodeLabel } from "@/lib/i18n/labels"
import { NODE_DEF_MAP } from "@/types/nodes"

/**
 * Display names for the config panel header, keyed by node type. Prefer
 * `nodeTypeDefaultLabel` (the node definition's own label) — this table is the
 * fallback for types with no definition, and it feeds the title-cased
 * fallback for unknown types.
 */
const NODE_TYPE_DISPLAY_NAMES: Record<string, string> = {
  "text-prompt": "Text",
  "upload-image": "Upload Image",
  "upload-video": "Upload Video",
  "upload-audio": "Upload Audio",
  "rss-feed": "RSS Feed",
  "youtube-video": "Video URL",
  "web-scrape": "Web Scrape",
  "video-analysis": "Video Analysis",
  "video-audit": "AI Audit",
  "reference-audio": "Reference Audio",
  "tone": "Tone",
  "style-guide": "Style Guide",
  "provider": "Provider",
  "scene-count": "Scene Count",
  "duration": "Duration",
  "aspect-ratio": "Aspect Ratio",
  "motion": "Motion",
  "camera-motion": "Camera Motion",
  "music-genre": "Music Genre",
  "music-mood": "Music Mood",
  "instrumentation": "Instrumentation",
  "voice-character": "Voice Character",
  "voice-delivery": "Voice Delivery",
  "framing": "Framing",
  "lens": "Lens",
  "camera-format": "Camera / Film Stock",
  "lighting": "Lighting",
  "color-look": "Color / Look",
  "atmosphere": "Atmosphere",
  "action-fx": "Action FX",
  "style": "Style",
  "setting": "Setting",
  "loop-subject": "Loop Subject",
  "person": "Person",
  "mood": "Mood",
  "photographer": "Photographer / Artist Style",
  "aesthetic": "Aesthetic / Microtrend",
  "era": "Era / Period",
  "pose": "Pose",
  "styling": "Styling",
  "material": "Material",
  "animal": "Animal",
  "vehicle": "Vehicle",
  "weapon": "Weapon",
  "furniture": "Furniture",
  "photo-genre": "Photo Genre",
  "backdrop": "Backdrop",
  "held-prop": "Held Prop",
  "temporal": "Temporal",
  "exposure-settings": "Exposure Settings",
  "render-quality": "Render Quality",
  "composition-effects": "Composition Effects",
  "post-process-effects": "Post-Process Effects",
  "transition": "Transition",
  "character-fx": "Character FX",
  "generate-script": "Generate Script",
  "generate-image": "Generate Image",
  "modify-image": "Modify Image",
  "upscale-image": "Upscale Image",
  "remove-background": "Remove Background",
  "generate-mask": "Generate Mask",
  "paint-mask": "Paint Mask",
  "image-to-video": "Image to Video",
  "video-to-video": "Video to Video",
  "switchx": "Relight & Switch",
  "text-to-video": "Text to Video",
  "generate-video": "Generate Video",
  "generate-video-pro": "Generate Video Pro",
  "edit-video-pro": "Edit Video Pro",
  "text-to-speech": "Text to Speech",
  "qa-check": "QA Check",
  "image-critic": "Image Critic",
  "generate-music": "Generate Music",
  "text-to-audio": "Text to Audio",
  "audio-isolation": "Voice Extractor",
  "text-to-dialogue": "Text to Dialogue",
  "voice-changer": "Voice Changer",
  "voice-changer-pro": "Voice Changer Pro",
  "dubbing": "Dubbing",
  "voice-remix": "Voice Remix",
  "voice-design": "Voice Design",
  "forced-alignment": "Forced Alignment",
  "suno-voice": "Suno Voice",
  "suno-generate": "Suno Generate",
  "suno-cover": "Suno Cover",
  "suno-extend": "Suno Extend",
  "suno-lyrics": "Suno Lyrics",
  "suno-separate": "Suno Separate",
  "audio-separation": "Audio Separation",
  "suno-music-video": "Music Video",
  "suno-mashup": "Suno Mashup",
  "suno-replace-section": "Suno Replace Section",
  "suno-style-boost": "Suno Style Boost",
  "suno-add-instrumental": "Suno Add Instrumental",
  "suno-add-vocals": "Suno Add Vocals",
  "suno-convert-wav": "Suno Convert WAV",
  "suno-upload-extend": "Suno Upload Extend",
  "transcribe": "Transcribe",
  "image-to-text": "Describe Image",
  "describe-to-picker": "Describe to Picker",
  "llm-chat": "Generate Text",
  "combine-videos": "Combine Videos",
  "assemble-narrated-video": "Assemble Narrated Video",
  "image-collage": "Image Collage",
  "merge-video-audio": "Merge Video & Audio",
  "add-captions": "Add Captions",
  "resize-video": "Resize Video",
  "social-media-format": "Social Media Format",
  "trim-audio": "Trim Audio",
  "split-media": "Split into Chunks",
  "extract-audio": "Extract Audio",
  "remove-audio": "Remove Audio",
  "mix-audio": "Mix Audio",
  "combine-audio": "Combine Audio",
  "adjust-volume": "Adjust Volume",
  "audio-fx": "Audio FX",
  "trim-video": "Trim Video",
  "extract-frame": "Extract Frame",
  "speed-ramp": "Adjust Speed",
  "loop-video": "Loop Video",
  "gif-to-video": "Gif to Video",
  "fade-video": "Fade In/Out",
  "still-to-video": "Still to Video",
  "slideshow": "Slideshow",
  "transcode-video": "Transcode Video",
  "manual-edit": "Manual Edit",
  "extend-video": "Extend Video",
  "video-retake": "Retake Video",
  "face-swap": "Face Swap",
  "video-sfx": "Video SFX",
  "speech-to-video": "Speech to Video",
  "ai-avatar": "AI Avatar",
  "cinematic-avatar": "Cinematic Avatar",
  "video-upscale": "Upscale Video",
  "combine-text": "Combine Text",
  "split-text": "Split Text",
  "extract-field": "Extract Field",
  "json-process": "JSON Process",
  "filter-list": "Filter List",
  "deduplicate": "Remove Duplicates",
  "merge-lists": "Merge Lists",
  "sort-list": "Sort List",
  "selector": "Selector",
  "reference-sheet": "Reference Sheet",
  "reference-board": "Reference Board",
  "preview": "Preview",
  "save-to-storage": "Save to Storage",
  "webhook-output": "Webhook Output",
  "character": "Character Asset",
  "object": "Object/Props Asset",
  "creature": "Animal/Creature Asset",
  "location": "Location Asset",
  "scene": "Scene",
  "sub-workflow-input": "Sub-Workflow Input",
  "sub-workflow-output": "Sub-Workflow Output",
  "sub-workflow": "Sub-Workflow",
  "component": "Component",
  "webhook-trigger": "Webhook Trigger",
  "schedule-trigger": "Schedule Trigger",
  "instagram-post": "Instagram Post",
  "tiktok-post": "TikTok Post",
  "youtube-upload": "YouTube Upload",
  "linkedin-post": "LinkedIn Post",
  "x-post": "X Post",
  "facebook-post": "Facebook Post",
  "telegram-post": "Telegram Post",
  "publish-social": "Publish to Social",
  "telegram-channel-feed": "Telegram Channel Feed",
  "telegram-trigger": "Telegram Trigger",
  "teleport-send": "Teleport Send",
  "teleport-receive": "Teleport Receive",
  "router": "Router",
  "reduce": "Choose Best",
  "generative-pipeline": "Story → Video",
  // Types whose title-cased fallback would miss the Hebrew node-label table.
  "3d-title": "3D Title",
  "video-composer": "Compose Video",
  "group": "Group",
  "collect": "Collect",
}

export function getNodeTypeDisplayName(type: string): string {
  return NODE_TYPE_DISPLAY_NAMES[type] || type.split("-").map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(" ")
}

/**
 * The label the palette PERSISTS for a node type (`NODE_DEFINITIONS[].label`,
 * mirrored into `defaultData.label`) — the exact string `NODE_LABELS_HE` is
 * keyed by. The Label field's round-trip (show localized → commit English)
 * compares against THIS, so it can never disagree with what the node stores.
 */
export function nodeTypeDefaultLabel(type: string): string {
  return NODE_DEF_MAP.get(type)?.label ?? getNodeTypeDisplayName(type)
}

/**
 * The config panel's Label field is bound to the node's PERSISTED label, which
 * for an untouched node is the English default ("Generate Image") — the same
 * string the canvas header localizes for display. The field shows that
 * localized form, so it reads like the header above it.
 */
export function nodeLabelFieldValue(stored: string, locale: LocaleId): string {
  return localizeNodeLabel(stored, locale)
}

/**
 * What to persist when the field changes. A typed name is a rename and is
 * kept verbatim. Typing the LOCALIZED default back (edit, then undo) maps to
 * the node type's English default, so a round-trip through the field never
 * turns a default into a translated custom name — the header would then stop
 * localizing it.
 */
export function nodeLabelFieldCommit(typed: string, typeDefault: string, locale: LocaleId): string {
  return typed === localizeNodeLabel(typeDefault, locale) ? typeDefault : typed
}
