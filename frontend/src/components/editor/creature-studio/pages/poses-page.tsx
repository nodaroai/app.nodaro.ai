import type { StudioPageProps } from "../../studio-shell/types"
import type { CreatureStudioState } from "../use-creature-studio"
import type { CreatureStudioJobs } from "../use-creature-studio-jobs"
import { PosesTab } from "../poses-tab"

/**
 * Poses page — thin wrapper binding the existing `PosesTab` to the shell's page
 * props. The tab owns its own jobs hook internally (and the Browse Pose catalog
 * affordance, gated on `tabKind === "poses"`).
 */
export function PosesPage({ state }: StudioPageProps<CreatureStudioState, CreatureStudioJobs>) {
  return (
    <div className="flex-1 overflow-y-auto p-4">
      <PosesTab studio={state} />
    </div>
  )
}
