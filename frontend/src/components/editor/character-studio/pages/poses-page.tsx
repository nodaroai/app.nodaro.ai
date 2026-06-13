import { useContext } from "react"
import type { StudioPageProps } from "../../studio-shell/types"
import type { CharacterStudioState } from "../use-character-studio"
import type { CharacterStudioJobs } from "../use-character-studio-jobs"
import { StudioNavContext } from "../../studio-shell/studio-shell"
import { PosesTab } from "../poses-tab"

export function PosesPage({ state, jobs }: StudioPageProps<CharacterStudioState, CharacterStudioJobs>) {
  const navigate = useContext(StudioNavContext) // the portrait CTA now jumps to Profile
  return <PosesTab state={state} jobs={jobs} onSwitchToAppearance={() => navigate("profile")} />
}
