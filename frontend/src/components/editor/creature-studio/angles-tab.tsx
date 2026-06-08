import { CreatureAssetTab } from "./creature-asset-tab"
import type { CreatureStudioState } from "./use-creature-studio"

/**
 * Angles tab — thin wrapper over `CreatureAssetTab` passing the `angles`
 * bucket + the preset strings. Mirrors the object-studio angles-tab.tsx.
 *
 * Presets map to the backend `generate-creature-asset` VARIANTS for the
 * `angles` assetType; any not in the VARIANTS map fall through the route's
 * "custom" path.
 */
const ANGLES_PRESETS = [
  "front",
  "side",
  "top",
  "back",
  "three-quarter",
  "detail",
  "in-context",
  "low-angle",
  "high-angle",
] as const

interface AnglesTabProps {
  readonly studio: CreatureStudioState
}

export function AnglesTab({ studio }: AnglesTabProps) {
  return (
    <CreatureAssetTab
      studio={studio}
      tabKind="angles"
      presets={ANGLES_PRESETS}
      iconLabel="📐 Angles"
    />
  )
}
