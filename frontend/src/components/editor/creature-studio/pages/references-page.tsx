import type { StudioPageProps } from "../../studio-shell/types"
import type { CreatureStudioState } from "../use-creature-studio"
import type { CreatureStudioJobs } from "../use-creature-studio-jobs"
import type { ObjectReferencePhoto } from "@/types/nodes"
import { ReferencePhotosSection } from "../reference-photos-section"

/**
 * References page — the creature reference-photo mood-board, relocated out of
 * the old `appearance-tab.tsx` into a first-class Resources group page.
 * `ReferencePhotosSection` renders its own header + reads/writes
 * `state.stagedData.referencePhotos`, so this is a thin scrolling wrapper.
 * Bound exactly as `appearance-tab.tsx` did (photos only — creatures reuse the
 * object reference-photo shape and never reference real-world people, so there
 * is no PII consent flow, unlike the location/character variants).
 */
export function ReferencesPage({ state }: StudioPageProps<CreatureStudioState, CreatureStudioJobs>) {
  const data = state.stagedData
  if (!data) return null
  return (
    <div className="flex-1 overflow-y-auto p-4">
      <ReferencePhotosSection
        photos={data.referencePhotos ?? []}
        onChange={(photos: ObjectReferencePhoto[]) => state.patch({ referencePhotos: photos })}
      />
    </div>
  )
}
