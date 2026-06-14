import { VoiceResource } from "../../studio-shell/voice-resource"
import type { StudioPageProps } from "../../studio-shell/types"
import type { CharacterStudioState } from "../use-character-studio"
import type { CharacterStudioJobs } from "../use-character-studio-jobs"

/**
 * Character Voice page — thin wrapper over the shared `VoiceResource` (Browse /
 * Clone / Design-audition + the selected-voice card + Talk panel). The whole
 * ~300-line surface now lives in `studio-shell/voice-resource.tsx` so the
 * creature studio reuses it verbatim.
 *
 * Behavior is byte-identical to the pre-extraction page: `state.staged.voice`
 * is the source of truth, `state.patch({ voice })` persists, and
 * `state.staged.sourceImageUrl` drives the lip-sync affordance.
 */
export function VoicePage({ state }: StudioPageProps<CharacterStudioState, CharacterStudioJobs>) {
  return (
    <VoiceResource
      voice={state.staged.voice}
      onVoiceChange={(voice) => state.patch({ voice })}
      sourceImageUrl={state.staged.sourceImageUrl}
    />
  )
}
