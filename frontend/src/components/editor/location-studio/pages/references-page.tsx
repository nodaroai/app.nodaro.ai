import type { StudioPageProps } from "../../studio-shell/types"
import type { LocationStudioState } from "../use-location-studio"
import type { LocationStudioJobs } from "../use-location-studio-jobs"
import type { LocationReferencePhoto } from "@/types/nodes"
import { ReferencePhotosSection } from "../reference-photos-section"

/**
 * References page — the location reference-photo mood-board, relocated out of
 * the old `appearance-tab.tsx` into a first-class Resources group page.
 * `ReferencePhotosSection` renders its own header + consent flow and
 * reads/writes `state.stagedData.referencePhotos`, so this is a thin scrolling
 * wrapper. Bound exactly as `appearance-tab.tsx` did (photos + consent).
 */
export function ReferencesPage({ state }: StudioPageProps<LocationStudioState, LocationStudioJobs>) {
  const data = state.stagedData
  if (!data) return null
  return (
    <div className="flex-1 overflow-y-auto p-4">
      <ReferencePhotosSection
        photos={data.referencePhotos ?? []}
        onChange={(photos: LocationReferencePhoto[]) => state.patch({ referencePhotos: photos })}
        piiConsentAt={data.piiConsentAt}
        onConsent={(timestamp: string) => state.patch({ piiConsentAt: timestamp })}
      />
    </div>
  )
}
