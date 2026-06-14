import type { StudioPageProps } from "../../studio-shell/types"
import type { LocationStudioState } from "../use-location-studio"
import type { LocationStudioJobs } from "../use-location-studio-jobs"
import { SeasonsTab } from "../seasons-tab"

/**
 * Seasons page — thin wrapper binding the existing `SeasonsTab` to the shell's
 * page props. The tab owns its own jobs hook internally.
 */
export function SeasonsPage({ state }: StudioPageProps<LocationStudioState, LocationStudioJobs>) {
  return (
    <div className="flex-1 overflow-y-auto p-4">
      <SeasonsTab studio={state} />
    </div>
  )
}
