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

import { AppearancePage } from "../appearance-page"
import { approveLocationMainImage, generateLocation } from "@/lib/api"
import type { LocationStudioState } from "../../use-location-studio"
import type { LocationStudioJobs } from "../../use-location-studio-jobs"

// The page owns its own candidate-tracking jobs hook; the shell-supplied `jobs`
// is an inert stub here (the Sheet page is the only consumer of that one).
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
    approveMainImage: vi.fn().mockResolvedValue({
      sourceImageUrl: "https://example.com/approved.png",
      canonicalDescription: "A warm cafe interior with golden afternoon light.",
    }),
    ...overrides,
  }
}

const renderPage = (studio: LocationStudioState) =>
  render(<AppearancePage state={studio} jobs={stubJobs} />)

describe("AppearancePage", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    toastError.mockClear()
    toastSuccess.mockClear()
    toastInfo.mockClear()
  })

  it("renders the identity form with name + description pre-populated from staged data", () => {
    renderPage(makeStudio())
    expect((screen.getByPlaceholderText(/cafe roma/i) as HTMLInputElement).value).toBe("Cafe Roma")
    expect((screen.getByPlaceholderText(/describe atmosphere/i) as HTMLTextAreaElement).value).toBe(
      "Cozy interior",
    )
  })

  it("Generate calls generateLocation with the selected count", async () => {
    vi.mocked(generateLocation).mockResolvedValueOnce({ jobIds: ["a", "b", "c", "d"] })
    const studio = makeStudio()
    renderPage(studio)
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
    renderPage(studio)
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
    renderPage(studio)
    await userEvent.click(screen.getByRole("button", { name: /^generate$/i }))
    expect(ensureSavedBeforeGen).toHaveBeenCalledTimes(1)
    expect(generateLocation).toHaveBeenCalledWith(
      expect.objectContaining({ attachToLocationId: "fresh-uuid" }),
    )
  })

  it("Generate is disabled when isApprovingMainImage is true", () => {
    const studio = makeStudio({ isApprovingMainImage: true })
    renderPage(studio)
    expect(screen.getByRole("button", { name: /^generate$/i })).toBeDisabled()
  })

  it("Generate is disabled when locationName is empty", () => {
    const studio = makeStudio({
      stagedData: {
        ...makeStudio().stagedData!,
        locationName: "",
      } as unknown as LocationStudioState["stagedData"],
    })
    renderPage(studio)
    expect(screen.getByRole("button", { name: /^generate$/i })).toBeDisabled()
  })

  it("Approve calls studio.approveMainImage with the candidate id (hook owns API + 409 recovery)", async () => {
    const studio = makeStudio()
    // The hook's approveMainImage now wraps the API call; the appearance
    // page no longer talks to approveLocationMainImage directly. The mock
    // resolves so the success branch fires (toast + clearing candidates).

    const { rerender } = renderPage(studio)

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

    rerender(<AppearancePage state={studio} jobs={stubJobs} />)

    const approveBtn = await screen.findByRole("button", { name: /^approve$/i })
    fireEvent.click(approveBtn)

    await act(async () => {
      await Promise.resolve()
    })

    // The appearance page now delegates to the hook — the raw API mock is no
    // longer called directly. The hook would call it (covered by the hook's
    // own test); here we only assert the wiring.
    expect(approveLocationMainImage).not.toHaveBeenCalled()
    expect(studio.approveMainImage).toHaveBeenCalledWith("candidate-1")
    expect(studio.setIsApprovingMainImage).toHaveBeenCalledWith(true)
    expect(studio.setIsApprovingMainImage).toHaveBeenLastCalledWith(false)
  }, 20000)

  it("Approve + Discard are disabled when a main-image generation job is in flight (Phase 2 #9)", async () => {
    // Drive the appearance page through a generate() so a tracked job exists
    // for assetType="main". Then assert the Approve + Discard buttons on a
    // sibling candidate card are disabled even before the job resolves.
    vi.mocked(generateLocation).mockResolvedValueOnce({ jobIds: ["cand-a", "cand-b"] })
    const { getJobStatusBatch } = await import("@/lib/api")
    // First poll: cand-a is completed (so a card renders); cand-b stays
    // pending (so a "main" job remains in tracked).
    vi.mocked(getJobStatusBatch).mockResolvedValueOnce({
      jobs: [
        {
          id: "cand-a",
          status: "completed",
          output_data: { imageUrl: "https://example.com/a.png" },
        },
        { id: "cand-b", status: "processing", output_data: null },
      ],
    })

    const studio = makeStudio()
    renderPage(studio)

    // count=2 so we kick off two tracked main jobs.
    await userEvent.click(screen.getByRole("button", { name: "2" }))
    await userEvent.click(screen.getByRole("button", { name: /^generate$/i }))

    // Wait for the poll to tick + the completed candidate to land in the grid.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10500))
    })

    const approveBtn = await screen.findByRole("button", { name: /^approve$/i })
    expect(approveBtn).toBeDisabled()
    const discardBtn = screen.getByRole("button", { name: /^discard$/i })
    expect(discardBtn).toBeDisabled()
  }, 20000)

  it("renders canonical description when present", () => {
    const studio = makeStudio({
      stagedData: {
        ...makeStudio().stagedData!,
        canonicalDescription: "A canonical paragraph about the location.",
      } as unknown as LocationStudioState["stagedData"],
    })
    renderPage(studio)
    expect(screen.getByText(/canonical paragraph about the location/i)).toBeInTheDocument()
    expect(screen.getByText(/^Canonical description$/i)).toBeInTheDocument()
  })

  it("does NOT render the ReferencePhotosSection (now on the References page)", () => {
    renderPage(makeStudio())
    expect(screen.queryByTestId("reference-photos-section")).not.toBeInTheDocument()
  })
})
