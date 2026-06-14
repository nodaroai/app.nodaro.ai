import type { StudioPageProps } from "../../studio-shell/types"
import type { ObjectStudioState } from "../use-object-studio"
import type { ObjectStudioJobs } from "../use-object-studio-jobs"
import { VariationsTab } from "../variations-tab"

/**
 * Variations page — thin wrapper binding the existing `VariationsTab` to the
 * shell's page props. The tab owns its own jobs hook internally.
 */
export function VariationsPage({ state }: StudioPageProps<ObjectStudioState, ObjectStudioJobs>) {
  return (
    <div className="flex-1 overflow-y-auto p-4">
      <VariationsTab studio={state} />
    </div>
  )
}
