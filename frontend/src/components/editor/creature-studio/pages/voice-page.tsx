import { VoiceResource } from "../../studio-shell/voice-resource"
import type { StudioPageProps } from "../../studio-shell/types"
import type { CreatureStudioState } from "../use-creature-studio"
import type { CreatureStudioJobs } from "../use-creature-studio-jobs"

/**
 * Creature Voice page — the "talking creature" surface (migration 220). Thin
 * wrapper over the shared `VoiceResource` (Browse / Clone / Design-audition +
 * the selected-voice card + Talk panel), the same component the character
 * studio uses. Creature stores the IDENTICAL `CharacterVoice` shape in
 * `data.voice`, so this is a straight binding:
 *  - `state.stagedData.voice` is the source of truth,
 *  - `state.patch({ voice })` persists (saved on the next Save → saveCreature),
 *  - `state.stagedData.sourceImageUrl` drives the lip-sync affordance.
 */
export function VoicePage({ state }: StudioPageProps<CreatureStudioState, CreatureStudioJobs>) {
  const data = state.stagedData
  if (!data) return null
  return (
    <VoiceResource
      voice={data.voice}
      onVoiceChange={(voice) => state.patch({ voice })}
      sourceImageUrl={data.sourceImageUrl}
    />
  )
}
