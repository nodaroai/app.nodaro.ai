/**
 * Node picker families — the single source of truth for how the add-node
 * popup and the sidebar group nodes.
 *
 * A family owns a set of node types and belongs to one tab. `NodeOption.group`
 * carries the owning family's id; `node-picker-families.test.ts` fails if the
 * two ever disagree, so a node can never render under no header.
 *
 * Tab membership is a DISPLAY superset ("deals with", not only "produces").
 * It is unrelated to IMAGE/VIDEO/AUDIO_PRODUCER_TYPES, which are execution
 * contracts (handle validation + backend output routing) and must not be
 * changed to affect what the picker shows.
 */
import type { SceneNodeType } from "@/types/nodes"

export type PickerTab =
  | "common" | "image" | "video" | "audio" | "models"
  | "assets" | "automate" | "publish" | "all"

/** Tab order in the tablist. `all` stays far right. */
export const PICKER_TABS: readonly PickerTab[] = [
  "common", "image", "video", "audio", "models", "assets", "automate", "publish", "all",
]

export interface NodeFamily {
  /** Stable id stored in `NodeOption.group`. */
  readonly id: string
  /** Header text. Rendered uppercase by the header style, not by this string. */
  readonly label: string
  /** Owning tab — also the `TAB · FAMILY` prefix on the All tab. */
  readonly tab: Exclude<PickerTab, "common" | "all"> | "controls"
  /** Node types the family owns, in display order. */
  readonly types: readonly SceneNodeType[]
}

export const NODE_FAMILIES: readonly NodeFamily[] = [
  {
    id: "image-add-your-own",
    label: "Add Your Own",
    tab: "image",
    types: ["upload-image"],
  },
  {
    id: "image-create",
    label: "Create",
    tab: "image",
    types: ["generate-image"],
  },
  {
    id: "image-edit-retouch",
    label: "Edit & Retouch",
    tab: "image",
    types: ["modify-image", "upscale-image", "remove-background", "generate-mask", "paint-mask", "image-collage", "extract-frame"],
  },
  {
    id: "image-references",
    label: "References",
    tab: "image",
    types: ["reference-sheet", "reference-board"],
  },
  {
    id: "image-understand",
    label: "Understand",
    tab: "image",
    types: ["image-to-text", "describe-to-picker", "image-critic"],
  },
  {
    id: "video-add-your-own",
    label: "Add Your Own",
    tab: "video",
    types: ["upload-video"],
  },
  {
    id: "video-create",
    label: "Create",
    tab: "video",
    types: ["generate-video", "generate-video-pro", "suno-music-video", "still-to-video", "slideshow"],
  },
  {
    id: "video-story-script",
    label: "Story & Script",
    tab: "video",
    types: ["generative-pipeline", "scene", "generate-script"],
  },
  {
    id: "video-animate-perform",
    label: "Animate & Perform",
    tab: "video",
    types: ["ai-avatar", "cinematic-avatar", "lip-sync", "speech-to-video", "motion-transfer", "face-swap"],
  },
  {
    id: "video-continue-restyle",
    label: "Continue & Restyle",
    tab: "video",
    types: ["extend-video", "edit-video-pro", "video-retake", "video-to-video", "switchx"],
  },
  {
    id: "video-cut-assemble",
    label: "Cut & Assemble",
    tab: "video",
    types: ["trim-video", "combine-videos", "assemble-narrated-video", "speed-ramp", "loop-video", "fade-video", "composite", "video-composer", "split-media", "manual-edit"],
  },
  {
    id: "video-sound",
    label: "Sound for Video",
    tab: "video",
    types: ["video-sfx", "merge-video-audio", "extract-audio", "remove-audio"],
  },
  {
    id: "video-titles-graphics",
    label: "Titles, Graphics & Captions",
    tab: "video",
    types: ["3d-title", "motion-graphics", "after-effects", "lottie-overlay", "add-captions", "render-video"],
  },
  {
    id: "video-format-export",
    label: "Format & Export",
    tab: "video",
    types: ["resize-video", "social-media-format", "video-upscale", "transcode-video", "gif-to-video"],
  },
  {
    id: "video-analyze",
    label: "Analyze",
    tab: "video",
    types: ["video-analysis", "video-audit"],
  },
  {
    id: "audio-add-your-own",
    label: "Add Your Own",
    tab: "audio",
    types: ["upload-audio", "reference-audio"],
  },
  {
    id: "audio-speech",
    label: "Speech & Voiceover",
    tab: "audio",
    types: ["text-to-speech", "text-to-dialogue"],
  },
  {
    id: "audio-voices",
    label: "Voices",
    tab: "audio",
    types: ["voice-changer", "voice-changer-pro", "voice-design", "voice-remix", "dubbing"],
  },
  {
    id: "audio-music",
    label: "Music",
    tab: "audio",
    types: ["suno-generate", "generate-music", "suno-lyrics", "suno-cover", "suno-extend", "suno-mashup", "suno-replace-section", "suno-add-vocals", "suno-add-instrumental", "suno-upload-extend", "suno-style-boost", "suno-convert-wav"],
  },
  {
    id: "audio-sfx",
    label: "Sound Effects",
    tab: "audio",
    types: ["text-to-audio"],
  },
  {
    id: "audio-clean-separate",
    label: "Clean & Separate",
    tab: "audio",
    types: ["audio-isolation", "audio-separation", "suno-separate"],
  },
  {
    id: "audio-edit",
    label: "Edit Audio",
    tab: "audio",
    types: ["trim-audio", "combine-audio", "mix-audio", "adjust-volume", "audio-fx"],
  },
  {
    id: "audio-transcribe",
    label: "Transcribe",
    tab: "audio",
    types: ["transcribe", "forced-alignment"],
  },
  {
    id: "models-generation-settings",
    label: "Generation Settings",
    tab: "models",
    types: ["provider", "aspect-ratio", "duration", "motion", "scene-count", "tone", "style-guide"],
  },
  {
    id: "assets-characters",
    label: "Characters",
    tab: "assets",
    types: ["character", "face"],
  },
  {
    id: "assets-creatures",
    label: "Creatures",
    tab: "assets",
    types: ["creature"],
  },
  {
    id: "assets-places",
    label: "Places",
    tab: "assets",
    types: ["location"],
  },
  {
    id: "assets-objects",
    label: "Objects",
    tab: "assets",
    types: ["object"],
  },
  {
    id: "automate-triggers",
    label: "Triggers",
    tab: "automate",
    types: ["schedule-trigger", "webhook-trigger", "telegram-trigger"],
  },
  {
    id: "automate-get-content",
    label: "Get Content",
    tab: "automate",
    types: ["web-scrape", "youtube-video", "telegram-channel-feed"],
  },
  {
    id: "automate-text",
    label: "Text",
    tab: "automate",
    types: ["text-prompt", "combine-text", "split-text", "llm-chat"],
  },
  {
    id: "automate-lists",
    label: "Lists & Batching",
    tab: "automate",
    types: ["list", "collect", "selector", "filter-list", "sort-list", "deduplicate", "merge-lists", "reduce"],
  },
  {
    id: "automate-logic",
    label: "Logic & Data",
    tab: "automate",
    types: ["router", "extract-field", "qa-check"],
  },
  {
    id: "automate-workflows",
    label: "Workflows",
    tab: "automate",
    types: ["sub-workflow", "component", "sub-workflow-input", "sub-workflow-output"],
  },
  {
    id: "automate-canvas",
    label: "Canvas",
    tab: "automate",
    types: ["group", "teleport-send", "teleport-receive", "preview", "sticky-note"],
  },
  {
    id: "publish-one-click",
    label: "One-Click",
    tab: "publish",
    types: ["publish-social"],
  },
  {
    id: "publish-platforms",
    label: "Platforms",
    tab: "publish",
    types: ["instagram-post", "tiktok-post", "youtube-upload", "facebook-post", "x-post", "linkedin-post", "telegram-post"],
  },
  {
    id: "publish-export",
    label: "Export",
    tab: "publish",
    types: ["save-to-storage", "webhook-output"],
  },
  {
    id: "cc-subject",
    label: "Subject",
    tab: "controls",
    types: ["person", "animal", "vehicle", "weapon"],
  },
  {
    id: "cc-wardrobe-pose",
    label: "Wardrobe & Pose",
    tab: "controls",
    types: ["styling", "pose"],
  },
  {
    id: "cc-scene",
    label: "Scene",
    tab: "controls",
    types: ["setting", "era", "furniture", "held-prop", "material", "backdrop", "loop-subject"],
  },
  {
    id: "cc-camera",
    label: "Camera",
    tab: "controls",
    types: ["framing", "lens", "camera-format", "exposure-settings"],
  },
  {
    id: "cc-light-look",
    label: "Light & Look",
    tab: "controls",
    types: ["lighting", "color-look", "mood", "atmosphere", "style", "photo-genre", "photographer", "render-quality", "aesthetic"],
  },
  {
    id: "cc-motion-time",
    label: "Motion & Time",
    tab: "controls",
    types: ["camera-motion", "temporal"],
  },
  {
    id: "cc-effects",
    label: "Effects",
    tab: "controls",
    types: ["action-fx", "character-fx", "composition-effects", "post-process-effects", "transition"],
  },
  {
    id: "cc-music-voice",
    label: "Music & Voice",
    tab: "controls",
    types: ["music-genre", "music-mood", "instrumentation", "voice-character", "voice-delivery", "suno-voice"],
  },
]

/** Creative Controls sub-families, in the order they expand. */
export const CREATIVE_CONTROL_FAMILY_IDS: readonly string[] = [
  "cc-subject", "cc-wardrobe-pose", "cc-scene", "cc-camera", "cc-light-look", "cc-motion-time", "cc-effects", "cc-music-voice",
]
/** Only the Audio tab shows MUSIC & VOICE. */
export const AUDIO_ONLY_CONTROL_FAMILY_ID = "cc-music-voice"

/** Nodes rendered inside a tab that does not own them, keyed by tab then
 *  family id. Their `group` still points at the owning family — this only
 *  affects where they are DISPLAYED (e.g. Text sits beside the uploads on
 *  every media tab, Video URL beside Upload Video). */
export const TAB_SUPERSET: Readonly<Record<string, Readonly<Record<string, readonly SceneNodeType[]>>>> = {
  image: {
    "image-add-your-own": ["text-prompt"],
  },
  video: {
    // Video URL before Text so the two "I already have footage" entries stay
    // adjacent and Text closes the family on every media tab alike.
    "video-add-your-own": ["youtube-video", "text-prompt"],
  },
  audio: {
    "audio-add-your-own": ["text-prompt"],
  },
  assets: {
    "image-references": ["reference-sheet", "reference-board"],
  },
}

/** Curated Common tab. Every member also appears in its owning family on
 *  another tab — no node exists only here. */
export const COMMON_SECTIONS: readonly { readonly id: string; readonly label: string; readonly types: readonly SceneNodeType[] }[] = [
  { id: "common-create", label: "Create", types: ["text-prompt", "generate-image", "generate-video", "generate-video-pro", "llm-chat", "generate-script", "text-to-speech", "suno-generate"] },
  { id: "common-edit", label: "Edit", types: ["modify-image", "manual-edit", "add-captions", "voice-changer"] },
  { id: "common-add-your-own", label: "Add Your Own", types: ["upload-image", "upload-video", "upload-audio", "youtube-video"] },
  { id: "common-reuse", label: "Build Once, Reuse", types: ["character", "location", "object"] },
  { id: "common-batch", label: "Batch", types: ["list"] },
  { id: "common-finish", label: "Finish", types: ["preview", "publish-social", "save-to-storage"] },
]

/** Up to 3 shortcuts pinned above the families on a media tab. Every entry
 *  also renders inside its own family below. */
export const POPULAR_TYPES: Readonly<Record<string, readonly SceneNodeType[]>> = {
  image: ["generate-image", "modify-image", "upload-image"],
  video: ["generate-video", "ai-avatar", "lip-sync"],
  audio: ["text-to-speech", "voice-changer", "suno-generate"],
}

const FAMILY_BY_ID = new Map(NODE_FAMILIES.map((f) => [f.id, f]))

/** Header text for a `NodeOption.group` value. Falls back to the raw value so
 *  an unregistered group still renders something readable. */
export function familyLabel(id: string | undefined): string | undefined {
  if (!id) return undefined
  return FAMILY_BY_ID.get(id)?.label ?? id
}

export function familyById(id: string): NodeFamily | undefined {
  return FAMILY_BY_ID.get(id)
}

/** Owning family id per node type — what `NodeOption.group` must equal. */
export const OWNER_FAMILY_BY_TYPE: ReadonlyMap<SceneNodeType, string> = new Map(
  NODE_FAMILIES.flatMap((f) => f.types.map((t) => [t, f.id] as const)),
)

/** Display order of a family within the All tab, which lists every family
 *  once under a `TAB · FAMILY` header. */
export const FAMILY_RANK: ReadonlyMap<string, number> = new Map(
  NODE_FAMILIES.map((f, i) => [f.id, i]),
)

const TAB_BADGE: Record<string, string> = {
  image: "IMAGE",
  video: "VIDEO",
  audio: "AUDIO",
  models: "MODELS",
  assets: "ASSETS",
  automate: "AUTOMATE",
  publish: "PUBLISH",
  controls: "CONTROLS",
}

/** Short tab label for a cross-tab search hit, so a row under "From other
 *  tabs" says where it lives instead of leaving the user to guess. */
export function tabBadgeForType(type: SceneNodeType): string | undefined {
  const id = OWNER_FAMILY_BY_TYPE.get(type)
  const family = id ? FAMILY_BY_ID.get(id) : undefined
  return family ? TAB_BADGE[family.tab] : undefined
}
