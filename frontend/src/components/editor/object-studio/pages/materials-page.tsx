import type { StudioPageProps } from "../../studio-shell/types"
import type { ObjectStudioState } from "../use-object-studio"
import type { ObjectStudioJobs } from "../use-object-studio-jobs"
import { MaterialsTab } from "../materials-tab"

/**
 * Materials page — thin wrapper binding the existing `MaterialsTab` to the
 * shell's page props. The tab owns its own jobs hook internally (and the
 * Browse Material catalog affordance, gated on `tabKind === "materials"`).
 */
export function MaterialsPage({ state }: StudioPageProps<ObjectStudioState, ObjectStudioJobs>) {
  return (
    <div className="flex-1 overflow-y-auto p-4">
      <MaterialsTab studio={state} />
    </div>
  )
}
