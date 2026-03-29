/** AI generation node types that support repeat-N execution.
 *  Excludes deterministic nodes, FFmpeg, social, render, and utility nodes. */
export const REPEATABLE_NODE_TYPES = new Set([
  "generate-image", "edit-image", "image-to-image",
  "image-to-video", "video-to-video", "text-to-video",
  "text-to-speech", "generate-music", "text-to-audio", "text-to-dialogue",
  "ai-writer", "generate-script",
  "suno-generate", "suno-cover", "suno-extend", "suno-lyrics",
  "lip-sync", "speech-to-video", "sora-storyboard",
  "motion-transfer", "extend-video",
  "video-composer", "after-effects", "lottie-overlay", "3d-title", "motion-graphics",
  "voice-changer", "dubbing", "voice-remix", "voice-design",
  "component",
])

/** Sentinel value used as list item for repeat-only execution (no list fan-out input).
 *  executeNodeForList skips the overridePrompt/overrideMediaUrl when it sees this. */
export const REPEAT_PLACEHOLDER = "__repeat__"

/** Read repeatCount from node data, clamped to 1-20. Returns 1 if unset/invalid. */
export function getEffectiveRepeatCount(nodeData: Record<string, unknown>): number {
  const raw = nodeData.repeatCount as number | undefined
  if (!raw || raw <= 1) return 1
  return Math.min(Math.max(Math.floor(raw), 1), 20)
}

/**
 * Expand list items by repeatCount, or create synthetic repeat items.
 * Returns null when no expansion is needed (single execution).
 */
export function expandItemsWithRepeat(
  listItems: string[] | undefined,
  nodeType: string,
  nodeData: Record<string, unknown>,
): string[] | null {
  const repeatCount = REPEATABLE_NODE_TYPES.has(nodeType)
    ? getEffectiveRepeatCount(nodeData)
    : 1

  if (listItems && listItems.length > 1) {
    const expanded = repeatCount > 1
      ? listItems.flatMap(item => Array(repeatCount).fill(item) as string[])
      : listItems
    return expanded
  }

  if (repeatCount > 1) {
    return Array(repeatCount).fill(REPEAT_PLACEHOLDER) as string[]
  }

  return null
}
