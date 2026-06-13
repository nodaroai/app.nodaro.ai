import type { StudioPageProps } from "../../studio-shell/types"
import type { CharacterStudioState } from "../use-character-studio"
import type { CharacterStudioJobs } from "../use-character-studio-jobs"
import { ReferencePhotosBlock } from "../reference-photos-block"

/**
 * References page — the 7-slot reference-photo uploader, relocated out of the
 * old Appearance tab into the Resources group. `ReferencePhotosBlock` renders
 * its own "Reference Photos" header and reads/writes `state.staged.referencePhotos`,
 * so this is a thin scrolling wrapper. Bound exactly as appearance-tab.tsx did.
 */
export function ReferencesPage({ state }: StudioPageProps<CharacterStudioState, CharacterStudioJobs>) {
  return (
    <div className="flex-1 overflow-y-auto p-4 space-y-4">
      <ReferencePhotosBlock
        photos={state.staged.referencePhotos ?? []}
        onChange={(next) => state.patch({ referencePhotos: next })}
      />
    </div>
  )
}
