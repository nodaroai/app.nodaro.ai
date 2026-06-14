import type { StudioPageProps } from "../../studio-shell/types"
import type { ObjectStudioState } from "../use-object-studio"
import type { ObjectStudioJobs } from "../use-object-studio-jobs"
import { MotionTab } from "../motion-tab"

/**
 * Motion page — thin wrapper binding the existing `MotionTab` (object motion
 * clips) to the shell's page props. The tab owns its own jobs hook internally.
 */
export function MotionPage({ state }: StudioPageProps<ObjectStudioState, ObjectStudioJobs>) {
  return (
    <div className="flex-1 overflow-y-auto p-4">
      <MotionTab studio={state} />
    </div>
  )
}
