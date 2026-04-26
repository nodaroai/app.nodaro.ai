/** AI generation node types that support repeat-N execution.
 *  Excludes deterministic nodes, FFmpeg, social, render, and utility nodes. */
export const REPEATABLE_NODE_TYPES = new Set([
  "generate-image", "edit-image", "image-to-image",
  "image-to-video", "video-to-video", "text-to-video",
  "text-to-speech", "generate-music", "text-to-audio", "text-to-dialogue",
  "ai-writer", "generate-script",
  "suno-generate", "suno-cover", "suno-extend", "suno-lyrics",
  "lip-sync", "speech-to-video",
  "motion-transfer", "extend-video",
  "video-composer", "after-effects", "lottie-overlay", "3d-title", "motion-graphics",
  "voice-changer", "dubbing", "voice-remix", "voice-design",
  "component",
])

/** Sentinel value used as list item for repeat-only execution (no list fan-out input).
 *  executeNodeForList skips the overridePrompt/overrideMediaUrl when it sees this. */
export const REPEAT_PLACEHOLDER = "__repeat__"

/** Sentinel prefix for per-iteration provider override.
 *  An item like `__provider:nano-banana__` tells executeNodeForList to clone the
 *  node with `data.provider = "nano-banana"` for that iteration and otherwise
 *  behave like REPEAT_PLACEHOLDER (no prompt/media override). */
export const PROVIDER_PLACEHOLDER_PREFIX = "__provider:"
const PROVIDER_PLACEHOLDER_SUFFIX = "__"

export function encodeProviderItem(provider: string): string {
  return `${PROVIDER_PLACEHOLDER_PREFIX}${provider}${PROVIDER_PLACEHOLDER_SUFFIX}`
}

export function decodeProviderItem(item: string): string | undefined {
  if (!item.startsWith(PROVIDER_PLACEHOLDER_PREFIX)) return undefined
  if (!item.endsWith(PROVIDER_PLACEHOLDER_SUFFIX)) return undefined
  const inner = item.slice(
    PROVIDER_PLACEHOLDER_PREFIX.length,
    item.length - PROVIDER_PLACEHOLDER_SUFFIX.length,
  )
  return inner.length > 0 ? inner : undefined
}

/** Read repeatCount from node data, clamped to 1-20. Returns 1 if unset/invalid. */
export function getEffectiveRepeatCount(nodeData: Record<string, unknown>): number {
  const raw = nodeData.repeatCount as number | undefined
  if (!raw || raw <= 1) return 1
  return Math.min(Math.max(Math.floor(raw), 1), 20)
}

/** Read providers array from node data. Returns the array only when it has 2+
 *  entries; one provider is equivalent to single-provider mode. */
function getEffectiveProviders(nodeData: Record<string, unknown>): readonly string[] | undefined {
  const raw = nodeData.providers as readonly unknown[] | undefined
  if (!raw || raw.length < 2) return undefined
  const cleaned = raw.filter((p): p is string => typeof p === "string" && p.length > 0)
  return cleaned.length >= 2 ? cleaned : undefined
}

/**
 * Expand list items by repeatCount, or create synthetic repeat / provider items.
 *
 * Resolution order:
 * 1. If an upstream list exists, the list drives expansion (repeatCount multiplies).
 * 2. Else if `data.providers` has 2+ entries, emit `providers.length × repeatCount`
 *    items — each provider runs `repeatCount` times consecutively.
 * 3. Else if repeatCount > 1, emit `repeatCount` synthetic items.
 * 4. Otherwise return null — single execution, no fan-out.
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

  const providers = getEffectiveProviders(nodeData)
  if (providers) {
    // Cross-product: each provider runs `repeatCount` times. Same provider's
    // iterations are grouped (better for UI progress + caching).
    return providers.flatMap(p =>
      Array(Math.max(repeatCount, 1)).fill(encodeProviderItem(p)) as string[],
    )
  }

  if (repeatCount > 1) {
    return Array(repeatCount).fill(REPEAT_PLACEHOLDER) as string[]
  }

  return null
}
