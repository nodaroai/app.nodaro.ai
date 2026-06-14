import type { StudioPageProps } from "../../studio-shell/types"
import type { LocationStudioState } from "../use-location-studio"
import type { LocationStudioJobs } from "../use-location-studio-jobs"
import { WeatherTab } from "../weather-tab"

/**
 * Weather page — thin wrapper binding the existing `WeatherTab` to the shell's
 * page props. The tab owns its own jobs hook internally.
 */
export function WeatherPage({ state }: StudioPageProps<LocationStudioState, LocationStudioJobs>) {
  return (
    <div className="flex-1 overflow-y-auto p-4">
      <WeatherTab studio={state} />
    </div>
  )
}
