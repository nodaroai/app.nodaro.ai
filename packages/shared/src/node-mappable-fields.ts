import { settingsInputFields } from "./settings-input.js"

/**
 * Per-node-type list of field names eligible for fieldMappings resolution.
 * Text fields also participate in {} injection when the resolver sees a
 * string value containing {} markers; non-text fields just receive the
 * mapped source's value verbatim.
 */
export const NODE_MAPPABLE_FIELDS: Readonly<Record<string, readonly string[]>> = {
  // + the fields its Settings input sets (settings-input.ts).
  "generate-image":      ["prompt", "style", "negativePrompt", ...settingsInputFields("generate-image")],
  "edit-image":          ["prompt", "style", "negativePrompt"],
  "image-to-image":      ["prompt", "style", "negativePrompt"],
  "modify-image":        ["prompt", "style", "negativePrompt"],
  "text-to-video":       ["prompt", "negativePrompt"],
  "image-to-video":      ["prompt"],
  // Unified t2v/i2v node — replaced the two deprecated keys above (kept only
  // for back-compat with un-migrated workflow JSON). Mirrors text-to-video so
  // fieldMappings/{} injection AND missing-ref detection work on the live node.
  // + the fields its Settings input sets (settings-input.ts): a Generation
  // Settings node wired there overrides the node's own aspect ratio, duration
  // and model at run time, through the same resolver as a field mapping.
  "generate-video":      ["prompt", "negativePrompt", ...settingsInputFields("generate-video")],
  // Trimmed multi-segment stitch variant of generate-video — prompt only, no
  // negativePrompt field on the node; + the fields its Settings input sets.
  "generate-video-pro":  ["prompt", ...settingsInputFields("generate-video-pro")],
  // Span-replace sibling of generate-video-pro — prompt only, no
  // negativePrompt field on the node.
  "edit-video-pro":      ["prompt"],
  "video-analysis":      ["analysisFocus", "youtubeUrl"],
  "video-to-video":      ["prompt"],
  "text-to-speech":      ["directText"],
  "lip-sync":            ["prompt"],
  "generate-music":      ["prompt", "lyrics", "genre", "mood"],
  "text-to-audio":       ["prompt"],
  "suno-generate":       ["prompt", "lyrics", "style", "title", "negativeStyle"],
  "suno-cover":          ["prompt", "lyrics", "style", "title", "negativeStyle"],
  "suno-extend":         ["prompt", "style", "title"],
  "suno-lyrics":         ["prompt"],
  "suno-replace-section":["prompt", "tags", "title", "fullLyrics", "negativeTags"],
  "suno-style-boost":    ["content"],
  "suno-upload-extend":  ["prompt", "style", "title"],
  "suno-mashup":         ["style", "title", "negativeStyle"],
  "voice-remix":         ["voiceDescription", "text"],
  "voice-design":        ["voiceDescription", "text"],
  "forced-alignment":    ["transcript"],
  "ai-writer":           ["systemPrompt", "userInput"],
  "llm-chat":            ["systemPrompt", "userInput"],
  "video-composer":      ["compositionPrompt"],
  "after-effects":       ["effectPrompt"],
  "lottie-overlay":      ["overlayPrompt"],
  "3d-title":            ["titlePrompt"],
  "generate-3d-scene":   ["scenePrompt"],
  "edit-3d-scene":       ["editPrompt"],
  "pro-3d-render":       ["scenePrompt"],
  "motion-graphics":     ["motionPrompt"],
  // Every field the panel offers a source for. Numbers arrive as text from a
  // Scene Count / Duration node; readScriptSettings coerces them on both engines.
  "generate-script":     ["styleGuide", "tone", "sceneCount", "targetLength"],
  "speech-to-video":     ["prompt", "negativePrompt"],
  "extend-video":        ["prompt"],
  "motion-transfer":     ["prompt"],
  "cinematic-avatar":    ["prompt"],
  "image-to-text":       ["customPrompt"],
  "instagram-post":      ["caption", "title"],
  "tiktok-post":         ["caption", "title"],
  "youtube-upload":      ["caption", "title"],
  "linkedin-post":       ["caption", "title"],
  "x-post":              ["caption", "title"],
  "facebook-post":       ["caption", "title"],
  "telegram-post":       ["caption", "title"],
  "save-to-storage":     ["filename"],
  "webhook-output":      ["url"],
  "character":           ["characterName", "description", "baseOutfit"],
  "face":                ["faceName", "description"],
  "object":              ["objectName", "description"],
  "creature":            ["creatureName", "description"],
  "location":            ["locationName", "description"],
  "web-scrape":          ["query", "url", "target"],
  "meta-ads-scrape":     ["query", "pageUrls"],
  "instagram-scrape":    ["targets"],
}

/** suno-generate secondary text fields exposed as `field-<key>` canvas handles. */
export const SUNO_FIELD_HANDLE_FIELDS = ["style", "lyrics", "title", "negativeStyle"] as const
/** Map a `field-<key>` handle id to its data key, or null if not a field handle. */
export function fieldKeyFromHandle(handleId: string): string | null {
  return handleId.startsWith("field-") ? handleId.slice("field-".length) : null
}
