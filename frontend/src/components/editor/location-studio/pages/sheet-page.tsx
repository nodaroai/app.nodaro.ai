import type { StudioPageProps } from "../../studio-shell/types"
import type { LocationStudioState } from "../use-location-studio"
import type { LocationStudioJobs } from "../use-location-studio-jobs"
import { ReferenceSheetTab } from "../../reference-sheet/reference-sheet-tab"
import { SHEET_TAB_ADAPTERS } from "../../reference-sheet/sheet-tab-adapter"

/**
 * Sheet page — the shared reference-sheet tab, bridged through the location
 * adapter. Reproduces the modal's previous sheet markup verbatim, consuming the
 * shell-supplied `jobs` (the modal's Stage-A panel tracker).
 */
export function SheetPage({ state, jobs }: StudioPageProps<LocationStudioState, LocationStudioJobs>) {
  return (
    <div className="flex-1 overflow-y-auto p-4">
      <ReferenceSheetTab adapter={SHEET_TAB_ADAPTERS.location} studio={state} jobs={jobs} accent="#22d3ee" />
    </div>
  )
}
