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

// Stub the supabase client so the realtime subscription inside the hook
// doesn't try to read VITE_SUPABASE_URL at test time.
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

import { AppearanceTab } from "../appearance-tab"
import { generateObject, approveObjectMainImage } from "@/lib/api"
import type { ObjectStudioState } from "../use-object-studio"
import type { ObjectNodeData } from "@/types/nodes"

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

describe("Object AppearanceTab", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    toastError.mockClear()
    toastSuccess.mockClear()
    toastInfo.mockClear()
  })

  it("renders the identity form with name + description pre-populated from staged data", () => {
    render(<AppearanceTab studio={makeStudio()} />)
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
    render(<AppearanceTab studio={studio} />)
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
    render(<AppearanceTab studio={studio} />)
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
    render(<AppearanceTab studio={studio} />)
    await userEvent.click(screen.getByRole("button", { name: /^generate$/i }))
    expect(ensureSavedBeforeGen).toHaveBeenCalledTimes(1)
    expect(generateObject).toHaveBeenCalledWith(
      expect.objectContaining({ attachToObjectId: "fresh-uuid" }),
    )
  })

  it("handles { jobId } single-result return shape", async () => {
    vi.mocked(generateObject).mockResolvedValueOnce({ jobId: "single-id" })
    const studio = makeStudio()
    render(<AppearanceTab studio={studio} />)
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
    render(<AppearanceTab studio={studio} />)
    await userEvent.click(screen.getByRole("button", { name: "2" }))
    await userEvent.click(screen.getByRole("button", { name: /^generate$/i }))
    await act(async () => {
      await Promise.resolve()
    })
    expect(screen.getByText(/generating 2 candidates/i)).toBeInTheDocument()
  })

  it("Generate is disabled when isApprovingMainImage is true", () => {
    const studio = makeStudio({ isApprovingMainImage: true })
    render(<AppearanceTab studio={studio} />)
    expect(screen.getByRole("button", { name: /^generate$/i })).toBeDisabled()
  })

  it("Generate is disabled when objectName is empty", () => {
    const studio = makeStudio({
      stagedData: makeStagedData({ objectName: "" }),
    })
    render(<AppearanceTab studio={studio} />)
    expect(screen.getByRole("button", { name: /^generate$/i })).toBeDisabled()
  })

  it("renders canonical description when present", () => {
    const studio = makeStudio({
      stagedData: makeStagedData({
        canonicalDescription: "A canonical paragraph about the object.",
      }),
    })
    render(<AppearanceTab studio={studio} />)
    expect(screen.getByText(/canonical paragraph about the object/i)).toBeInTheDocument()
    expect(screen.getByText(/^Canonical description$/i)).toBeInTheDocument()
  })

  it("mounts the ReferencePhotosSection", () => {
    render(<AppearanceTab studio={makeStudio()} />)
    expect(screen.getByTestId("reference-photos-section")).toBeInTheDocument()
  })

  it("does NOT call approveObjectMainImage directly (hook owns the API call)", () => {
    // Smoke check — the appearance tab should never import or call
    // approveObjectMainImage directly. The mock proves it stays unused.
    render(<AppearanceTab studio={makeStudio()} />)
    expect(approveObjectMainImage).not.toHaveBeenCalled()
  })

  // Upstream picker banner — E1 legacyPickerSelection breadcrumb surface
  it("renders UpstreamPickerBanner when legacyPickerSelection is set", () => {
    const studio = makeStudio({
      stagedData: makeStagedData({
        legacyPickerSelection: { kind: "furniture", id: "chesterfield-sofa" },
      }),
    })
    render(<AppearanceTab studio={studio} />)
    expect(screen.getByText(/legacy picker selection detected/i)).toBeInTheDocument()
  })

  it("does NOT render UpstreamPickerBanner when legacyPickerSelection is null (dismissed)", () => {
    const studio = makeStudio({
      stagedData: makeStagedData({ legacyPickerSelection: null }),
    })
    render(<AppearanceTab studio={studio} />)
    expect(screen.queryByText(/legacy picker selection detected/i)).not.toBeInTheDocument()
  })

  it("does NOT render UpstreamPickerBanner when legacyPickerSelection is undefined (no migration)", () => {
    const studio = makeStudio({
      stagedData: makeStagedData({ legacyPickerSelection: undefined }),
    })
    render(<AppearanceTab studio={studio} />)
    expect(screen.queryByText(/legacy picker selection detected/i)).not.toBeInTheDocument()
  })

  it("UpstreamPickerBanner dismiss calls patch({ legacyPickerSelection: null })", async () => {
    const studio = makeStudio({
      stagedData: makeStagedData({
        legacyPickerSelection: { kind: "animal", id: "wolf" },
      }),
    })
    render(<AppearanceTab studio={studio} />)
    const dismissBtn = screen.getByRole("button", { name: /dismiss/i })
    fireEvent.click(dismissBtn)
    expect(studio.patch).toHaveBeenCalledWith({ legacyPickerSelection: null })
  })
})
