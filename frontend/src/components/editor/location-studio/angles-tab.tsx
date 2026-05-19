import { EnvironmentalAssetTab } from "./environmental-asset-tab"
import type { LocationStudioState } from "./use-location-studio"

/**
 * Angles tab — thin wrapper over `EnvironmentalAssetTab` passing the
 * `angles` bucket + the 8 preset strings.
 *
 * Preset list MUST exactly match `VARIANTS.angles` in
 * `backend/src/routes/generate-location-asset.ts` so the route's Zod enum
 * check passes at generate-time. The backend's `buildVariantPrompt` switch
 * is also keyed on these exact strings — case + spelling are load-bearing.
 */
const ANGLES_PRESETS = [
  "wide",
  "medium",
  "closeup",
  "aerial",
  "low-angle",
  "eye-level",
  "bird's-eye",
  "dutch tilt",
] as const

interface AnglesTabProps {
  readonly studio: LocationStudioState
}

export function AnglesTab({ studio }: AnglesTabProps) {
  return (
    <EnvironmentalAssetTab
      studio={studio}
      bucketName="angles"
      presets={ANGLES_PRESETS}
      iconLabel="🎥 Angles"
    />
  )
}
