import type { StudioPageProps } from "../../studio-shell/types"
import type { CreatureStudioState } from "../use-creature-studio"
import type { CreatureStudioJobs } from "../use-creature-studio-jobs"
import { MotionTab } from "../motion-tab"

/**
 * Motion page — thin wrapper binding the existing `MotionTab` (creature motion
 * clips) to the shell's page props. The tab owns its own jobs hook internally.
 */
export function MotionPage({ state }: StudioPageProps<CreatureStudioState, CreatureStudioJobs>) {
  return (
    <div className="flex-1 overflow-y-auto p-4">
      <MotionTab studio={state} />
    </div>
  )
}
