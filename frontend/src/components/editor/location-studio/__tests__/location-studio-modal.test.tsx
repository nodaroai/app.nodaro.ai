import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"

// Stub the studio hook — the actual hook needs Zustand + React Query and is
// covered in its own test file. Here we only need to drive the modal shell.
const mockStudioState = {
  stagedData: {
    label: "Location",
    locationDbId: "",
    locationName: "Cafe Roma",
    description: "",
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
  } as unknown as Record<string, unknown> | null,
  isDirty: false,
  isSaving: false,
  isApprovingMainImage: false,
  setIsApprovingMainImage: vi.fn(),
  patch: vi.fn(),
  saveStaged: vi.fn().mockResolvedValue("uuid-1"),
  ensureSavedBeforeGen: vi.fn().mockResolvedValue("uuid-1"),
}
vi.mock("../use-location-studio", () => ({
  useLocationStudio: () => mockStudioState,
}))

// Stub appearance tab so the test doesn't depend on its internals.
vi.mock("../appearance-tab", () => ({
  AppearanceTab: () => <div data-testid="appearance-tab-mounted">appearance-tab</div>,
}))

import { LocationStudioModal } from "../location-studio-modal"

describe("LocationStudioModal", () => {
  beforeEach(() => {
    mockStudioState.stagedData = {
      label: "Location",
      locationDbId: "",
      locationName: "Cafe Roma",
      description: "",
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
    } as unknown as Record<string, unknown>
    mockStudioState.isDirty = false
    mockStudioState.isSaving = false
    mockStudioState.isApprovingMainImage = false
    vi.clearAllMocks()
    mockStudioState.saveStaged = vi.fn().mockResolvedValue("uuid-1")
    mockStudioState.ensureSavedBeforeGen = vi.fn().mockResolvedValue("uuid-1")
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("renders the header title from stagedData and mounts the Appearance tab", () => {
    render(<LocationStudioModal nodeId="loc-1" onClose={() => {}} />)
    expect(screen.getByRole("heading", { name: /cafe roma/i })).toBeInTheDocument()
    expect(screen.getByTestId("appearance-tab-mounted")).toBeInTheDocument()
    expect(screen.getByRole("dialog")).toHaveAttribute("aria-modal", "true")
  })

  it("renders 'Loading location…' placeholder when stagedData is null (cold-load)", () => {
    mockStudioState.stagedData = null
    render(<LocationStudioModal nodeId="loc-1" onClose={() => {}} />)
    expect(screen.getByText(/loading location/i)).toBeInTheDocument()
    expect(screen.queryByTestId("appearance-tab-mounted")).not.toBeInTheDocument()
  })

  it("Escape closes when not dirty (no confirm)", () => {
    const onClose = vi.fn()
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true)
    render(<LocationStudioModal nodeId="loc-1" onClose={onClose} />)
    fireEvent.keyDown(window, { key: "Escape" })
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(confirmSpy).not.toHaveBeenCalled()
  })

  it("Escape prompts via window.confirm when dirty; cancel keeps modal open", () => {
    mockStudioState.isDirty = true
    const onClose = vi.fn()
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false)
    render(<LocationStudioModal nodeId="loc-1" onClose={onClose} />)
    fireEvent.keyDown(window, { key: "Escape" })
    expect(confirmSpy).toHaveBeenCalledWith("Discard unsaved changes?")
    expect(onClose).not.toHaveBeenCalled()
  })

  it("Save button is disabled when not dirty and enabled when dirty", () => {
    mockStudioState.isDirty = false
    const { rerender } = render(<LocationStudioModal nodeId="loc-1" onClose={() => {}} />)
    expect(screen.getByRole("button", { name: /^save$/i })).toBeDisabled()

    mockStudioState.isDirty = true
    rerender(<LocationStudioModal nodeId="loc-1" onClose={() => {}} />)
    expect(screen.getByRole("button", { name: /^save$/i })).not.toBeDisabled()
  })

  it("Close button is disabled while saving (Z-9)", () => {
    mockStudioState.isSaving = true
    render(<LocationStudioModal nodeId="loc-1" onClose={() => {}} />)
    expect(screen.getByRole("button", { name: /close/i })).toBeDisabled()
  })

  it("Style Lock toggle calls patch with the new value", () => {
    render(<LocationStudioModal nodeId="loc-1" onClose={() => {}} />)
    const toggle = screen.getByRole("checkbox", { name: /style lock/i })
    fireEvent.click(toggle)
    expect(mockStudioState.patch).toHaveBeenCalledWith({ styleLock: true })
  })
})
