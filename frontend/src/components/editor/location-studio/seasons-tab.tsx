import { EnvironmentalAssetTab } from "./environmental-asset-tab"
import type { LocationStudioState } from "./use-location-studio"

/**
 * Seasons tab — thin wrapper over `EnvironmentalAssetTab` passing the
 * `seasons` bucket + the 4 preset strings.
 *
 * Preset list MUST exactly match `VARIANTS.seasons` in
 * `backend/src/routes/generate-location-asset.ts` so the route's Zod enum
 * check passes at generate-time. The backend's `buildVariantPrompt` switch
 * is also keyed on these exact strings — case + spelling are load-bearing.
 */
const SEASONS_PRESETS = ["spring", "summer", "autumn", "winter"] as const

interface SeasonsTabProps {
  readonly studio: LocationStudioState
}

export function SeasonsTab({ studio }: SeasonsTabProps) {
  return (
    <EnvironmentalAssetTab
      studio={studio}
      bucketName="seasons"
      presets={SEASONS_PRESETS}
      iconLabel="🍂 Seasons"
    />
  )
}
