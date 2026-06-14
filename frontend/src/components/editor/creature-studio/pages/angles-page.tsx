import type { StudioPageProps } from "../../studio-shell/types"
import type { CreatureStudioState } from "../use-creature-studio"
import type { CreatureStudioJobs } from "../use-creature-studio-jobs"
import { AnglesTab } from "../angles-tab"

/**
 * Angles page — thin wrapper binding the existing `AnglesTab` to the shell's
 * page props. The tab owns its own jobs hook internally.
 */
export function AnglesPage({ state }: StudioPageProps<CreatureStudioState, CreatureStudioJobs>) {
  return (
    <div className="flex-1 overflow-y-auto p-4">
      <AnglesTab studio={state} />
    </div>
  )
}
