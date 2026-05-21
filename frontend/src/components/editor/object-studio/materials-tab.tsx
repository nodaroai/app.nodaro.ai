import { ObjectAssetTab } from "./object-asset-tab"
import type { ObjectStudioState } from "./use-object-studio"

/**
 * Materials tab — thin wrapper over `ObjectAssetTab` passing the `materials`
 * bucket + the 13 preset strings.
 *
 * The Materials tab uniquely includes the Browse Material catalog
 * affordance — that lives inside `ObjectAssetTab` and is gated on
 * `tabKind === "materials"`, so the wrapper doesn't need to compose it
 * separately. Picking from the catalog fires the same generation flow as
 * a free-form custom prompt, seeded with the catalog entry's promptHint.
 */
const MATERIALS_PRESETS = [
  "wood",
  "metal",
  "glass",
  "plastic",
  "fabric",
  "stone",
  "ceramic",
  "leather",
  "paper",
  "gold",
  "silver",
  "copper",
  "marble",
] as const

interface MaterialsTabProps {
  readonly studio: ObjectStudioState
}

export function MaterialsTab({ studio }: MaterialsTabProps) {
  return (
    <ObjectAssetTab
      studio={studio}
      tabKind="materials"
      presets={MATERIALS_PRESETS}
      iconLabel="🧪 Materials"
    />
  )
}
