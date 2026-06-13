import type { StudioPageProps } from "../../studio-shell/types"
import type { CharacterStudioState } from "../use-character-studio"
import type { CharacterStudioJobs } from "../use-character-studio-jobs"
import { ReferenceSheetTab } from "../../reference-sheet/reference-sheet-tab"
import { SHEET_TAB_ADAPTERS } from "../../reference-sheet/sheet-tab-adapter"

/**
 * Sheet page — the shared reference-sheet tab, bridged through the character
 * adapter. Reproduces the modal's previous markup verbatim (the sheet is NOT a
 * `*Tab` with an `onSwitchToAppearance` CTA).
 */
export function SheetPage({ state, jobs }: StudioPageProps<CharacterStudioState, CharacterStudioJobs>) {
  return (
    <div className="flex-1 overflow-y-auto p-4">
      <ReferenceSheetTab adapter={SHEET_TAB_ADAPTERS.character} studio={state} jobs={jobs} accent="#3b82f6" />
    </div>
  )
}
