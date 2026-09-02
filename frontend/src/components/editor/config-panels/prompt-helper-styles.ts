/**
 * The node types whose prompt field gets the prompt-helper (style wizard)
 * button. The per-type style PRESET tables that used to live here were dead
 * code — no surface read them (`getStylesForNodeType` had no callers); the
 * wizard's own options come from the localized catalogs in @nodaro/shared —
 * so only the membership survives.
 */
const PROMPT_CONSUMER_TYPES: ReadonlySet<string> = new Set([
  "generate-image",
  "edit-image",
  "image-to-image",
  "text-to-video",
  "image-to-video",
  "video-to-video",
  "switchx",
  "speech-to-video",
  "motion-transfer",
  "extend-video",
  "generate-music",
  "suno-generate",
  "text-to-audio",
  "video-sfx",
])

/** Returns true if the node type is a known prompt-consuming type (gets the prompt helper). */
export function hasPromptConsumerType(nodeType: string): boolean {
  return PROMPT_CONSUMER_TYPES.has(nodeType)
}
