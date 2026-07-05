import { OBJECT_ANGLE_PRESETS } from "@nodaro/prompts"
import { ObjectAssetTab } from "./object-asset-tab"
import type { ObjectStudioState } from "./use-object-studio"

/**
 * Angles tab — thin wrapper over `ObjectAssetTab` passing the `angles` bucket
 * + the angle preset chips.
 *
 * The preset list is the shared single source of truth
 * (`@nodaro/shared` → `OBJECT_ANGLE_PRESETS`) — the SAME constant the backend
 * route (`generate-object-asset.ts` VARIANTS) validates against, so the chips
 * and the route can never drift (the drift that 400'd the extra presets).
 */
interface AnglesTabProps {
  readonly studio: ObjectStudioState
}

export function AnglesTab({ studio }: AnglesTabProps) {
  return (
    <ObjectAssetTab
      studio={studio}
      tabKind="angles"
      presets={OBJECT_ANGLE_PRESETS}
      iconLabel="📐 Angles"
    />
  )
}
