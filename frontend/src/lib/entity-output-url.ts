import type { GeneratedResult } from "@/types/nodes"

/**
 * The image URL an entity node (character / object / location / creature) emits
 * on its `image` handle / primary output — mirrors the node's displayed
 * thumbnail: the user-selected default asset (starred in the Studio) wins, else
 * the active generated result, else the persisted source image. Single source of
 * truth shared by `extractNodeOutput` (run) and the config-panel reference
 * preview builders so the previewed image can't drift from the emitted one.
 */
export function entityActiveImageUrl(data: Record<string, unknown>): string | undefined {
  const results = (data.generatedResults as GeneratedResult[] | undefined) ?? []
  const activeIndex = (data.activeResultIndex as number | undefined) ?? 0
  // `||` (not `??`) so an empty-string defaultAssetUrl falls through, matching
  // the `defaultAssetUrl || ... || sourceImageUrl` thumbnail logic in
  // character/object/location/creature-node.tsx.
  return (
    (data.defaultAssetUrl as string | undefined) ||
    results[activeIndex]?.url ||
    (data.sourceImageUrl as string | undefined)
  )
}
