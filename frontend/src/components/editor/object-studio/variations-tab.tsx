import { OBJECT_VARIATION_PRESETS } from "@nodaro/shared"
import { ObjectAssetTab } from "./object-asset-tab"
import type { ObjectStudioState } from "./use-object-studio"

/**
 * Variations tab — thin wrapper over `ObjectAssetTab` passing the `variations`
 * bucket + the variation preset chips (shared single source of truth
 * `@nodaro/shared` → `OBJECT_VARIATION_PRESETS`, validated by the backend route).
 */
interface VariationsTabProps {
  readonly studio: ObjectStudioState
}

export function VariationsTab({ studio }: VariationsTabProps) {
  return (
    <ObjectAssetTab
      studio={studio}
      tabKind="variations"
      presets={OBJECT_VARIATION_PRESETS}
      iconLabel="✨ Variations"
    />
  )
}
