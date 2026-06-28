import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, act } from "@testing-library/react"
import userEvent from "@testing-library/user-event"

// Hoisted API mocks.
vi.mock("@/lib/api", () => ({
  generateObject: vi.fn(),
  approveObjectMainImage: vi.fn(),
  getJobStatusBatch: vi.fn().mockResolvedValue({ jobs: [] }),
  ConcurrentModificationError: class ConcurrentModificationError extends Error {
    constructor() {
      super("concurrent_modification")
    }
  },
}))

const toastError = vi.fn()
const toastSuccess = vi.fn()
const toastInfo = vi.fn()
vi.mock("sonner", () => ({
  toast: {
    error: (...args: unknown[]) => toastError(...args),
    success: (...args: unknown[]) => toastSuccess(...args),
    info: (...args: unknown[]) => toastInfo(...args),
  },
}))

// Stub the supabase client so the realtime subscription inside the page's
// candidate-tracking jobs hook doesn't try to read VITE_SUPABASE_URL at test
// time.
vi.mock("@/lib/supabase", () => ({
  createClient: () => ({
    channel: () => ({
      on: () => ({ subscribe: () => ({}) }),
    }),
    removeChannel: () => {},
  }),
}))

vi.mock("@/hooks/use-auth", () => ({
  getCachedUserId: () => "user-1",
}))

import { AppearancePage } from "../appearance-page"
import { ObjectCandidatesContext } from "../../object-candidates-context"
import { useObjectCandidates } from "../../use-object-candidates"
import { generateObject, approveObjectMainImage } from "@/lib/api"
import type { ObjectStudioState } from "../../use-object-studio"
import type { ObjectStudioJobs } from "../../use-object-studio-jobs"
import type { ObjectNodeData } from "@/types/nodes"

// The page owns its own candidate-tracking jobs hook; the shell-supplied `jobs`
// is an inert stub here (the Sheet page is the only consumer of that one).
const stubJobs: ObjectStudioJobs = {
  tracked: [],
  trackJob: vi.fn(),
  beginJob: vi.fn(() => "optimistic:test"),
  settleJob: vi.fn(),
  abortJob: vi.fn(),
  onResolved: vi.fn(),
  onFailed: vi.fn(),
}

function makeStagedData(overrides: Partial<ObjectNodeData> = {}): ObjectNodeData {
  return {
    label: "Object",
    objectDbId: "obj-uuid-1",
    objectName: "Vintage Lamp",
    description: "Brass Edison lamp",
    category: "other",
    style: "realistic",
    sourceImageUrl: "",
    projectId: "proj-1",
    createdAt: "",
    executionStatus: "idle",
    generatedResults: [],
    activeResultIndex: 0,
    fieldMappings: {},
    angles: [],
    materials: [],
    variations: [],
    anglesStatus: "idle",
    materialsStatus: "idle",
    variationsStatus: "idle",
    customVariations: [],
    motionClips: [],
    motionStatus: "idle",
    referencePhotos: [],
    canonicalDescription: "",
    styleLock: false,
    ...overrides,
  } as unknown as ObjectNodeData
}

function makeStudio(overrides: Partial<ObjectStudioState> = {}): ObjectStudioState {
  return {
    stagedData: makeStagedData(),
    isDirty: false,
    isSaving: false,
    isApprovingMainImage: false,
    setIsApprovingMainImage: vi.fn(),
    patch: vi.fn(),
    saveStaged: vi.fn().mockResolvedValue("obj-uuid-1"),
    ensureSavedBeforeGen: vi.fn().mockResolvedValue("obj-uuid-1"),
    approveMainImage: vi.fn().mockResolvedValue({
      sourceImageUrl: "https://example.com/approved.png",
      canonicalDescription: "A vintage brass Edison lamp with patina.",
    }),
    ...overrides,
  }
}

// The candidate state + jobs tracker now live at MODAL scope and reach the page
// via ObjectCandidatesContext. Mount the REAL useObjectCandidates hook in a thin
// harness so the page's Generate/candidate behavior is exercised end-to-end
// (the hook owns the generateObject call + jobs tracking). The supabase +
// getJobStatusBatch mocks above keep the underlying jobs hook inert.
function Harness({ studio }: { studio: ObjectStudioState }) {
  const cands = useObjectCandidates(studio)
  return (
    <ObjectCandidatesContext.Provider value={cands}>
      <AppearancePage state={studio} jobs={stubJobs} />
    </ObjectCandidatesContext.Provider>
  )
}

const renderPage = (studio: ObjectStudioState) => render(<Harness studio={studio} />)

describe("Object AppearancePage", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    toastError.mockClear()
    toastSuccess.mockClear()
    toastInfo.mockClear()
  })

  it("renders the identity form with name + description pre-populated from staged data", () => {
    renderPage(makeStudio())
    expect((screen.getByPlaceholderText(/glowing rune sword/i) as HTMLInputElement).value).toBe(
      "Vintage Lamp",
    )
    expect((screen.getByPlaceholderText(/describe form, material/i) as HTMLTextAreaElement).value).toBe(
      "Brass Edison lamp",
    )
  })

  it("Generate calls generateObject with the selected count", async () => {
    vi.mocked(generateObject).mockResolvedValueOnce({ jobIds: ["a", "b", "c", "d"] })
    const studio = makeStudio()
    renderPage(studio)
    await userEvent.click(screen.getByRole("button", { name: "4" }))
    await userEvent.click(screen.getByRole("button", { name: /^generate$/i }))
    expect(generateObject).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "Vintage Lamp",
        count: 4,
        attachToObjectId: undefined,
      }),
    )
  })

  it("Generate with count=1 passes attachToObjectId (Q-8 attach-on-completion)", async () => {
    vi.mocked(generateObject).mockResolvedValueOnce({ jobId: "job-1" })
    const studio = makeStudio()
    renderPage(studio)
    await userEvent.click(screen.getByRole("button", { name: /^generate$/i }))
    expect(studio.ensureSavedBeforeGen).toHaveBeenCalledTimes(1)
    expect(generateObject).toHaveBeenCalledWith(
      expect.objectContaining({
        count: 1,
        attachToObjectId: "obj-uuid-1",
      }),
    )
  })

  it("Generate auto-saves when objectDbId is empty (Q-8 first-generate path)", async () => {
    const ensureSavedBeforeGen = vi.fn().mockResolvedValue("fresh-uuid")
    vi.mocked(generateObject).mockResolvedValueOnce({ jobId: "job-1" })
    const studio = makeStudio({
      ensureSavedBeforeGen,
      stagedData: makeStagedData({ objectDbId: "" }),
    })
    renderPage(studio)
    await userEvent.click(screen.getByRole("button", { name: /^generate$/i }))
    expect(ensureSavedBeforeGen).toHaveBeenCalledTimes(1)
    expect(generateObject).toHaveBeenCalledWith(
      expect.objectContaining({ attachToObjectId: "fresh-uuid" }),
    )
  })

  it("handles { jobId } single-result return shape", async () => {
    vi.mocked(generateObject).mockResolvedValueOnce({ jobId: "single-id" })
    const studio = makeStudio()
    renderPage(studio)
    await userEvent.click(screen.getByRole("button", { name: /^generate$/i }))
    // Single jobId should have been forwarded into jobs.trackJob (covered by
    // the side-effect on the "Generating … candidate" status text).
    await act(async () => {
      await Promise.resolve()
    })
    expect(screen.getByText(/generating 1 candidate/i)).toBeInTheDocument()
  })

  it("handles { jobIds } multi-result return shape", async () => {
    vi.mocked(generateObject).mockResolvedValueOnce({ jobIds: ["a", "b"] })
    const studio = makeStudio()
    renderPage(studio)
    await userEvent.click(screen.getByRole("button", { name: "2" }))
    await userEvent.click(screen.getByRole("button", { name: /^generate$/i }))
    await act(async () => {
      await Promise.resolve()
    })
    expect(screen.getByText(/generating 2 candidates/i)).toBeInTheDocument()
  })

  it("Generate is disabled when isApprovingMainImage is true", () => {
    const studio = makeStudio({ isApprovingMainImage: true })
    renderPage(studio)
    expect(screen.getByRole("button", { name: /^generate$/i })).toBeDisabled()
  })

  it("Generate is disabled when objectName is empty", () => {
    const studio = makeStudio({
      stagedData: makeStagedData({ objectName: "" }),
    })
    renderPage(studio)
    expect(screen.getByRole("button", { name: /^generate$/i })).toBeDisabled()
  })

  it("renders canonical description when present", () => {
    const studio = makeStudio({
      stagedData: makeStagedData({
        canonicalDescription: "A canonical paragraph about the object.",
      }),
    })
    renderPage(studio)
    expect(screen.getByText(/canonical paragraph about the object/i)).toBeInTheDocument()
    expect(screen.getByText(/^Canonical description$/i)).toBeInTheDocument()
  })

  it("does NOT render the ReferencePhotosSection (now on the References page)", () => {
    renderPage(makeStudio())
    expect(screen.queryByTestId("reference-photos-section")).not.toBeInTheDocument()
  })

  it("does NOT call approveObjectMainImage directly (hook owns the API call)", () => {
    // Smoke check — the appearance page should never import or call
    // approveObjectMainImage directly. The mock proves it stays unused.
    renderPage(makeStudio())
    expect(approveObjectMainImage).not.toHaveBeenCalled()
  })

  // Upstream picker banner — E1 legacyPickerSelection breadcrumb surface
  it("renders UpstreamPickerBanner when legacyPickerSelection is set", () => {
    const studio = makeStudio({
      stagedData: makeStagedData({
        legacyPickerSelection: { kind: "furniture", id: "chesterfield-sofa" },
      }),
    })
    renderPage(studio)
    expect(screen.getByText(/legacy picker selection detected/i)).toBeInTheDocument()
  })

  it("does NOT render UpstreamPickerBanner when legacyPickerSelection is null (dismissed)", () => {
    const studio = makeStudio({
      stagedData: makeStagedData({ legacyPickerSelection: null }),
    })
    renderPage(studio)
    expect(screen.queryByText(/legacy picker selection detected/i)).not.toBeInTheDocument()
  })

  it("does NOT render UpstreamPickerBanner when legacyPickerSelection is undefined (no migration)", () => {
    const studio = makeStudio({
      stagedData: makeStagedData({ legacyPickerSelection: undefined }),
    })
    renderPage(studio)
    expect(screen.queryByText(/legacy picker selection detected/i)).not.toBeInTheDocument()
  })

  it("UpstreamPickerBanner dismiss calls patch({ legacyPickerSelection: null })", async () => {
    const studio = makeStudio({
      stagedData: makeStagedData({
        legacyPickerSelection: { kind: "animal", id: "wolf" },
      }),
    })
    renderPage(studio)
    const dismissBtn = screen.getByRole("button", { name: /dismiss/i })
    fireEvent.click(dismissBtn)
    expect(studio.patch).toHaveBeenCalledWith({ legacyPickerSelection: null })
  })
})
