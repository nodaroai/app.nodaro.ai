import type { StudioPageProps } from "../../studio-shell/types"
import type { LocationStudioState } from "../use-location-studio"
import type { LocationStudioJobs } from "../use-location-studio-jobs"
import { LightingTab } from "../lighting-tab"

/**
 * Lighting page — thin wrapper binding the existing `LightingTab` to the
 * shell's page props. The tab owns its own jobs hook internally.
 */
export function LightingPage({ state }: StudioPageProps<LocationStudioState, LocationStudioJobs>) {
  return (
    <div className="flex-1 overflow-y-auto p-4">
      <LightingTab studio={state} />
    </div>
  )
}
