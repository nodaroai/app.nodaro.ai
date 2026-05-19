import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, act } from "@testing-library/react"
import userEvent from "@testing-library/user-event"

// Hoisted API mocks.
vi.mock("@/lib/api", () => ({
  generateLocation: vi.fn(),
  approveLocationMainImage: vi.fn(),
  getJobStatusBatch: vi.fn().mockResolvedValue({ jobs: [] }),
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

import { AppearanceTab } from "../appearance-tab"
import { approveLocationMainImage, generateLocation } from "@/lib/api"
import type { LocationStudioState } from "../use-location-studio"

function makeStudio(overrides: Partial<LocationStudioState> = {}): LocationStudioState {
  return {
    stagedData: {
      label: "Location",
      locationDbId: "loc-uuid-1",
      locationName: "Cafe Roma",
      description: "Cozy interior",
      category: "indoor",
      style: "realistic",
      sourceImageUrl: "",
      projectId: "proj-1",
      createdAt: "",
      executionStatus: "idle",
      generatedResults: [],
      activeResultIndex: 0,
      fieldMappings: {},
      timeOfDay: [],
      weather: [],
      angles: [],
      lighting: [],
      lightingStatus: "idle",
      seasons: [],
      seasonsStatus: "idle",
      atmosphereMotions: [],
      atmosphereStatus: "idle",
      referencePhotos: [],
      canonicalDescription: "",
      styleLock: false,
      timeOfDayStatus: "idle",
      weatherStatus: "idle",
      anglesStatus: "idle",
      customVariations: [],
    } as unknown as LocationStudioState["stagedData"],
    isDirty: false,
    isSaving: false,
    isApprovingMainImage: false,
    setIsApprovingMainImage: vi.fn(),
    patch: vi.fn(),
    saveStaged: vi.fn().mockResolvedValue("loc-uuid-1"),
    ensureSavedBeforeGen: vi.fn().mockResolvedValue("loc-uuid-1"),
    ...overrides,
  }
}

describe("AppearanceTab", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    toastError.mockClear()
    toastSuccess.mockClear()
    toastInfo.mockClear()
  })

  it("renders the identity form with name + description pre-populated from staged data", () => {
    render(<AppearanceTab studio={makeStudio()} />)
    expect((screen.getByPlaceholderText(/cafe roma/i) as HTMLInputElement).value).toBe("Cafe Roma")
    expect((screen.getByPlaceholderText(/describe atmosphere/i) as HTMLTextAreaElement).value).toBe(
      "Cozy interior",
    )
  })

  it("Generate calls generateLocation with the selected count", async () => {
    vi.mocked(generateLocation).mockResolvedValueOnce({ jobIds: ["a", "b", "c", "d"] })
    const studio = makeStudio()
    render(<AppearanceTab studio={studio} />)
    // Switch to count=4.
    await userEvent.click(screen.getByRole("button", { name: "4" }))
    await userEvent.click(screen.getByRole("button", { name: /^generate$/i }))
    expect(generateLocation).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "Cafe Roma",
        count: 4,
        attachToLocationId: undefined, // count !== 1 → no attach
      }),
    )
  })

  it("Generate with count=1 passes attachToLocationId (Q-8 attach-on-completion)", async () => {
    vi.mocked(generateLocation).mockResolvedValueOnce({ jobId: "job-1" })
    const studio = makeStudio()
    render(<AppearanceTab studio={studio} />)
    await userEvent.click(screen.getByRole("button", { name: /^generate$/i }))
    expect(studio.ensureSavedBeforeGen).toHaveBeenCalledTimes(1)
    expect(generateLocation).toHaveBeenCalledWith(
      expect.objectContaining({
        count: 1,
        attachToLocationId: "loc-uuid-1",
      }),
    )
  })

  it("Generate auto-saves when locationDbId is empty (Q-8 first-generate path)", async () => {
    const ensureSavedBeforeGen = vi.fn().mockResolvedValue("fresh-uuid")
    vi.mocked(generateLocation).mockResolvedValueOnce({ jobId: "job-1" })
    const studio = makeStudio({
      ensureSavedBeforeGen,
      stagedData: {
        ...makeStudio().stagedData!,
        locationDbId: "",
      } as unknown as LocationStudioState["stagedData"],
    })
    render(<AppearanceTab studio={studio} />)
    await userEvent.click(screen.getByRole("button", { name: /^generate$/i }))
    expect(ensureSavedBeforeGen).toHaveBeenCalledTimes(1)
    expect(generateLocation).toHaveBeenCalledWith(
      expect.objectContaining({ attachToLocationId: "fresh-uuid" }),
    )
  })

  it("Generate is disabled when isApprovingMainImage is true", () => {
    const studio = makeStudio({ isApprovingMainImage: true })
    render(<AppearanceTab studio={studio} />)
    expect(screen.getByRole("button", { name: /^generate$/i })).toBeDisabled()
  })

  it("Generate is disabled when locationName is empty", () => {
    const studio = makeStudio({
      stagedData: {
        ...makeStudio().stagedData!,
        locationName: "",
      } as unknown as LocationStudioState["stagedData"],
    })
    render(<AppearanceTab studio={studio} />)
    expect(screen.getByRole("button", { name: /^generate$/i })).toBeDisabled()
  })

  it("Approve calls approveLocationMainImage and patches sourceImageUrl + canonicalDescription", async () => {
    const studio = makeStudio()
    vi.mocked(approveLocationMainImage).mockResolvedValueOnce({
      sourceImageUrl: "https://example.com/approved.png",
      canonicalDescription: "A warm cafe interior with golden afternoon light.",
    })

    // Render with a candidate already in state by directly mounting then
    // pushing one through the onResolved callback. The hook's onResolved
    // setter is wired in useEffect, so we trigger via generateLocation +
    // simulating the batch return.
    const { rerender } = render(<AppearanceTab studio={studio} />)

    // Approval button only renders when there are candidates. To exercise
    // approve path deterministically, switch the component to a state where
    // a candidate exists. We do this by simulating handleGenerate + manually
    // injecting via the hook. Simpler: drive the user click on Approve by
    // first generating and then resolving the job through the mocked batch.

    vi.mocked(generateLocation).mockResolvedValueOnce({ jobId: "candidate-1" })
    const { getJobStatusBatch } = await import("@/lib/api")
    vi.mocked(getJobStatusBatch).mockResolvedValueOnce({
      jobs: [
        {
          id: "candidate-1",
          status: "completed",
          output_data: { imageUrl: "https://example.com/cand.png" },
        },
      ],
    })

    await userEvent.click(screen.getByRole("button", { name: /^generate$/i }))

    // Allow the polling interval to tick once. We can't await the actual
    // timer in jsdom; use vi.useFakeTimers + advance.
    // POLL_MS is 10s (Phase 2 #12 throttled the fallback now that realtime
    // is the primary signal), plus up to 200ms of jitter on top.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10500))
    })

    rerender(<AppearanceTab studio={studio} />)

    const approveBtn = await screen.findByRole("button", { name: /^approve$/i })
    fireEvent.click(approveBtn)

    await act(async () => {
      await Promise.resolve()
    })

    expect(approveLocationMainImage).toHaveBeenCalledWith("loc-uuid-1", "candidate-1")
    expect(studio.setIsApprovingMainImage).toHaveBeenCalledWith(true)
    expect(studio.setIsApprovingMainImage).toHaveBeenLastCalledWith(false)
    expect(studio.patch).toHaveBeenCalledWith({
      sourceImageUrl: "https://example.com/approved.png",
      canonicalDescription: "A warm cafe interior with golden afternoon light.",
    })
  }, 20000)

  it("renders canonical description when present", () => {
    const studio = makeStudio({
      stagedData: {
        ...makeStudio().stagedData!,
        canonicalDescription: "A canonical paragraph about the location.",
      } as unknown as LocationStudioState["stagedData"],
    })
    render(<AppearanceTab studio={studio} />)
    expect(screen.getByText(/canonical paragraph about the location/i)).toBeInTheDocument()
    expect(screen.getByText(/^Canonical description$/i)).toBeInTheDocument()
  })

  it("mounts the ReferencePhotosSection", () => {
    render(<AppearanceTab studio={makeStudio()} />)
    expect(screen.getByTestId("reference-photos-section")).toBeInTheDocument()
  })
})
