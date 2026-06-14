import type { StudioPageProps } from "../../studio-shell/types"
import type { LocationStudioState } from "../use-location-studio"
import type { LocationStudioJobs } from "../use-location-studio-jobs"
import { TimeOfDayTab } from "../time-of-day-tab"

/**
 * Time of Day page — thin wrapper binding the existing `TimeOfDayTab` (which
 * owns its own jobs hook internally) to the shell's page props. The shared
 * `flex-1 overflow-y-auto p-4` scroll frame replaces the old modal's `<main>`.
 */
export function TimeOfDayPage({ state }: StudioPageProps<LocationStudioState, LocationStudioJobs>) {
  return (
    <div className="flex-1 overflow-y-auto p-4">
      <TimeOfDayTab studio={state} />
    </div>
  )
}
