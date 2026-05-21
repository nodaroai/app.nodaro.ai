import { ObjectAssetTab } from "./object-asset-tab"
import type { ObjectStudioState } from "./use-object-studio"

/**
 * Variations tab — thin wrapper over `ObjectAssetTab` passing the
 * `variations` bucket + the 11 preset strings.
 *
 * Preset list extends the current `VARIANTS.variations` in
 * `backend/src/routes/generate-object-asset.ts` (5 entries) with 6 more
 * (broken/antique/futuristic/holographic/dirty/polished). New presets fall
 * through the route's "custom" path until the VARIANTS map is extended in
 * a follow-up.
 */
const VARIATIONS_PRESETS = [
  "clean",
  "weathered",
  "damaged",
  "ornate",
  "minimal",
  "broken",
  "antique",
  "futuristic",
  "holographic",
  "dirty",
  "polished",
] as const

interface VariationsTabProps {
  readonly studio: ObjectStudioState
}

export function VariationsTab({ studio }: VariationsTabProps) {
  return (
    <ObjectAssetTab
      studio={studio}
      tabKind="variations"
      presets={VARIATIONS_PRESETS}
      iconLabel="✨ Variations"
    />
  )
}
