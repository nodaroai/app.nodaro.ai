import { describe, it, expect, vi } from "vitest"
import { render, screen } from "@testing-library/react"

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() },
}))

import { ReferencesPage } from "../references-page"
import type { ObjectStudioState } from "../../use-object-studio"
import type { ObjectStudioJobs } from "../../use-object-studio-jobs"

const stubJobs: ObjectStudioJobs = {
  tracked: [],
  trackJob: vi.fn(),
  onResolved: vi.fn(),
  onFailed: vi.fn(),
}

function makeStudio(overrides: Partial<ObjectStudioState> = {}): ObjectStudioState {
  return {
    stagedData: {
      label: "Object",
      objectDbId: "obj-uuid-1",
      objectName: "Vintage Lamp",
      description: "",
      category: "other",
      style: "realistic",
      sourceImageUrl: "",
      referencePhotos: [],
    } as unknown as ObjectStudioState["stagedData"],
    isDirty: false,
    isSaving: false,
    isApprovingMainImage: false,
    setIsApprovingMainImage: vi.fn(),
    patch: vi.fn(),
    saveStaged: vi.fn().mockResolvedValue("obj-uuid-1"),
    ensureSavedBeforeGen: vi.fn().mockResolvedValue("obj-uuid-1"),
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
