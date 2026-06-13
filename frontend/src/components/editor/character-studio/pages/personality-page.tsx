import type { StudioPageProps } from "../../studio-shell/types"
import type { CharacterStudioState } from "../use-character-studio"
import type { CharacterStudioJobs } from "../use-character-studio-jobs"
import { PersonalityTab } from "../personality-tab"

export function PersonalityPage({ state }: StudioPageProps<CharacterStudioState, CharacterStudioJobs>) {
  return <PersonalityTab state={state} />
}
