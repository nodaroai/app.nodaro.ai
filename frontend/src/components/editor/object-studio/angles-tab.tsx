import { ObjectAssetTab } from "./object-asset-tab"
import type { ObjectStudioState } from "./use-object-studio"

/**
 * Angles tab — thin wrapper over `ObjectAssetTab` passing the `angles`
 * bucket + the 9 preset strings.
 *
 * Preset list extends the current `VARIANTS.angles` in
 * `backend/src/routes/generate-object-asset.ts` (5 entries) with 4 more
 * (detail/in-context/exploded/perspective). New presets fall through the
 * route's "custom" path until the VARIANTS map is extended in a follow-up.
 */
const ANGLES_PRESETS = [
  "front",
  "side",
  "top",
  "back",
  "three-quarter",
  "detail",
  "in-context",
  "exploded",
  "perspective",
] as const

interface AnglesTabProps {
  readonly studio: ObjectStudioState
}

export function AnglesTab({ studio }: AnglesTabProps) {
  return (
    <ObjectAssetTab
      studio={studio}
      tabKind="angles"
      presets={ANGLES_PRESETS}
      iconLabel="📐 Angles"
    />
  )
}
