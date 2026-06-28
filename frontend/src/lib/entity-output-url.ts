import type { GeneratedResult } from "@/types/nodes"

/**
 * The image URL an entity node (character / object / location / creature) emits
 * on its `image` handle / primary output — the active generated result, else
 * the persisted source image. Single source of truth shared by
 * `extractNodeOutput` (run) and the config-panel reference preview builders so
 * the previewed image can't drift from the emitted one.
 */
export function entityActiveImageUrl(data: Record<string, unknown>): string | undefined {
  const results = (data.generatedResults as GeneratedResult[] | undefined) ?? []
  const activeIndex = (data.activeResultIndex as number | undefined) ?? 0
  return results[activeIndex]?.url ?? (data.sourceImageUrl as string | undefined)
}
