import { CreatureAssetTab } from "./creature-asset-tab"
import type { CreatureStudioState } from "./use-creature-studio"

/**
 * Poses tab — thin wrapper over `CreatureAssetTab` passing the `poses`
 * bucket + the preset strings. This is the creature analog of the object
 * Materials tab (materials → poses delta): a living creature has poses, not
 * material finishes.
 *
 * The Poses tab uniquely includes the Browse Pose catalog affordance — that
 * lives inside `CreatureAssetTab` and is gated on `tabKind === "poses"`, so
 * the wrapper doesn't need to compose it separately. Picking from the catalog
 * fires the same generation flow as a free-form custom prompt, seeded with
 * the catalog entry's promptHint.
 *
 * Presets map to the backend `generate-creature-asset` VARIANTS for the
 * `poses` assetType; any not in the VARIANTS map fall through the route's
 * "custom" path.
 */
const POSES_PRESETS = [
  "standing",
  "sitting",
  "lying-down",
  "walking",
  "running",
  "jumping",
  "alert",
  "playful",
  "aggressive",
] as const

interface PosesTabProps {
  readonly studio: CreatureStudioState
}

export function PosesTab({ studio }: PosesTabProps) {
  return (
    <CreatureAssetTab
      studio={studio}
      tabKind="poses"
      presets={POSES_PRESETS}
      iconLabel="🧍 Poses"
    />
  )
}
