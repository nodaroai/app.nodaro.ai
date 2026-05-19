import { EnvironmentalAssetTab } from "./environmental-asset-tab"
import type { LocationStudioState } from "./use-location-studio"

/**
 * Time of Day tab — thin wrapper over `EnvironmentalAssetTab` passing the
 * `timeOfDay` bucket + the 9 preset strings.
 *
 * Preset list MUST exactly match `VARIANTS.timeOfDay` in
 * `backend/src/routes/generate-location-asset.ts` so the route's Zod enum
 * check passes at generate-time. The backend's `buildVariantPrompt` switch
 * is also keyed on these exact strings — case + spelling are load-bearing.
 */
const TIME_OF_DAY_PRESETS = [
  "dawn",
  "morning",
  "noon",
  "afternoon",
  "golden hour",
  "dusk",
  "blue hour",
  "night",
  "midnight",
] as const

interface TimeOfDayTabProps {
  readonly studio: LocationStudioState
}

export function TimeOfDayTab({ studio }: TimeOfDayTabProps) {
  return (
    <EnvironmentalAssetTab
      studio={studio}
      bucketName="timeOfDay"
      presets={TIME_OF_DAY_PRESETS}
      iconLabel="🌅 Time of Day"
    />
  )
}
