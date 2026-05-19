import { EnvironmentalAssetTab } from "./environmental-asset-tab"
import type { LocationStudioState } from "./use-location-studio"

/**
 * Lighting tab — thin wrapper over `EnvironmentalAssetTab` passing the
 * `lighting` bucket + the 8 preset strings.
 *
 * Preset list MUST exactly match `VARIANTS.lighting` in
 * `backend/src/routes/generate-location-asset.ts` so the route's Zod enum
 * check passes at generate-time. The backend's `buildVariantPrompt` switch
 * is also keyed on these exact strings — case + spelling are load-bearing.
 */
const LIGHTING_PRESETS = [
  "soft natural",
  "harsh sunlight",
  "golden",
  "blue hour",
  "neon",
  "candlelit",
  "cinematic",
  "dramatic chiaroscuro",
] as const

interface LightingTabProps {
  readonly studio: LocationStudioState
}

export function LightingTab({ studio }: LightingTabProps) {
  return (
    <EnvironmentalAssetTab
      studio={studio}
      bucketName="lighting"
      presets={LIGHTING_PRESETS}
      iconLabel="💡 Lighting"
    />
  )
}
