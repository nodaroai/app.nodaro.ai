import { OBJECT_MATERIAL_PRESETS } from "@nodaro/prompts"
import { ObjectAssetTab } from "./object-asset-tab"
import type { ObjectStudioState } from "./use-object-studio"

/**
 * Materials tab — thin wrapper over `ObjectAssetTab` passing the `materials`
 * bucket + the material preset chips (shared single source of truth
 * `@nodaro/shared` → `OBJECT_MATERIAL_PRESETS`, validated by the backend route).
 *
 * The Materials tab uniquely includes the Browse Material catalog affordance —
 * that lives inside `ObjectAssetTab` and is gated on `tabKind === "materials"`,
 * so the wrapper doesn't need to compose it separately. Picking from the catalog
 * fires the same generation flow as a free-form custom prompt, seeded with the
 * catalog entry's promptHint.
 */
interface MaterialsTabProps {
  readonly studio: ObjectStudioState
}

export function MaterialsTab({ studio }: MaterialsTabProps) {
  return (
    <ObjectAssetTab
      studio={studio}
      tabKind="materials"
      presets={OBJECT_MATERIAL_PRESETS}
      iconLabel="🧪 Materials"
    />
  )
}
