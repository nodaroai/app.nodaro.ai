import { CreatureAssetTab } from "./creature-asset-tab"
import type { CreatureStudioState } from "./use-creature-studio"

/**
 * Variations tab — thin wrapper over `CreatureAssetTab` passing the
 * `variations` bucket + the preset strings. Mirrors the object-studio
 * variations-tab.tsx, with creature-appropriate presets (coat / age / mood
 * variants of a living creature rather than an object's material states).
 *
 * Presets map to the backend `generate-creature-asset` VARIANTS for the
 * `variations` assetType; any not in the VARIANTS map fall through the
 * route's "custom" path.
 */
const VARIATIONS_PRESETS = [
  "juvenile",
  "adult",
  "elder",
  "albino",
  "melanistic",
  "battle-scarred",
  "majestic",
  "fluffy",
  "sleek",
] as const

interface VariationsTabProps {
  readonly studio: CreatureStudioState
}

export function VariationsTab({ studio }: VariationsTabProps) {
  return (
    <CreatureAssetTab
      studio={studio}
      tabKind="variations"
      presets={VARIATIONS_PRESETS}
      iconLabel="✨ Variations"
    />
  )
}
