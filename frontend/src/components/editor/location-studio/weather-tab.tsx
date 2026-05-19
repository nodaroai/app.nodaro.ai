import { EnvironmentalAssetTab } from "./environmental-asset-tab"
import type { LocationStudioState } from "./use-location-studio"

/**
 * Weather tab — thin wrapper over `EnvironmentalAssetTab` passing the
 * `weather` bucket + the 9 preset strings.
 *
 * Preset list MUST exactly match `VARIANTS.weather` in
 * `backend/src/routes/generate-location-asset.ts` so the route's Zod enum
 * check passes at generate-time. The backend's `buildVariantPrompt` switch
 * is also keyed on these exact strings — case + spelling are load-bearing.
 */
const WEATHER_PRESETS = [
  "clear",
  "cloudy",
  "light rain",
  "heavy rain",
  "storm",
  "snow",
  "blizzard",
  "fog",
  "mist",
] as const

interface WeatherTabProps {
  readonly studio: LocationStudioState
}

export function WeatherTab({ studio }: WeatherTabProps) {
  return (
    <EnvironmentalAssetTab
      studio={studio}
      bucketName="weather"
      presets={WEATHER_PRESETS}
      iconLabel="🌦 Weather"
    />
  )
}
