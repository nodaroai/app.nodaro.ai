import { describe, it, expect, vi } from "vitest"
import { render, screen } from "@testing-library/react"

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() },
}))

import { ReferencesPage } from "../references-page"
import type { LocationStudioState } from "../../use-location-studio"
import type { LocationStudioJobs } from "../../use-location-studio-jobs"

const stubJobs: LocationStudioJobs = {
  tracked: [],
  trackJob: vi.fn(),
  onResolved: vi.fn(),
  onFailed: vi.fn(),
}

function makeStudio(overrides: Partial<LocationStudioState> = {}): LocationStudioState {
  return {
    stagedData: {
      label: "Location",
      locationDbId: "loc-uuid-1",
      locationName: "Cafe Roma",
      description: "",
      category: "indoor",
      style: "realistic",
      sourceImageUrl: "",
      referencePhotos: [],
      piiConsentAt: undefined,
    } as unknown as LocationStudioState["stagedData"],
    isDirty: false,
    isSaving: false,
    isApprovingMainImage: false,
    setIsApprovingMainImage: vi.fn(),
    patch: vi.fn(),
    saveStaged: vi.fn().mockResolvedValue("loc-uuid-1"),
    ensureSavedBeforeGen: vi.fn().mockResolvedValue("loc-uuid-1"),
    approveMainImage: vi.fn(),
    ...overrides,
  }
}

describe("ReferencesPage", () => {
  it("mounts the ReferencePhotosSection bound to staged reference photos", () => {
    render(<ReferencesPage state={makeStudio()} jobs={stubJobs} />)
    expect(screen.getByTestId("reference-photos-section")).toBeInTheDocument()
  })

  it("renders null on cold-load (stagedData null)", () => {
    const studio = makeStudio({ stagedData: null })
    const { container } = render(<ReferencesPage state={studio} jobs={stubJobs} />)
    expect(container).toBeEmptyDOMElement()
    expect(screen.queryByTestId("reference-photos-section")).not.toBeInTheDocument()
  })
})
