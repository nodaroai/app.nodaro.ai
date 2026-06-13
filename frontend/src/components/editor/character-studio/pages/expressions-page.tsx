import { useContext } from "react"
import type { StudioPageProps } from "../../studio-shell/types"
import type { CharacterStudioState } from "../use-character-studio"
import type { CharacterStudioJobs } from "../use-character-studio-jobs"
import { StudioNavContext } from "../../studio-shell/studio-shell"
import { ExpressionsTab } from "../expressions-tab"

export function ExpressionsPage({ state, jobs }: StudioPageProps<CharacterStudioState, CharacterStudioJobs>) {
  const navigate = useContext(StudioNavContext) // the portrait CTA now jumps to Profile
  return <ExpressionsTab state={state} jobs={jobs} onSwitchToAppearance={() => navigate("profile")} />
}
