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

// The modal-level jobs hook is only consumed by the Sheet page (stubbed below);
// stub it inert so the realtime subscription effect never runs in tests.
vi.mock("../use-location-studio-jobs", () => ({
  useLocationStudioJobs: () => ({
    tracked: [],
    trackJob: vi.fn(),
    onResolved: vi.fn(),
    onFailed: vi.fn(),
  }),
}))

// Stub the page modules so the test doesn't depend on their internals. Each
// renders a uniquely-id'd marker we can assert on to confirm body switching
// through the shared StudioShell.
vi.mock("../pages/references-page", () => ({
  ReferencesPage: () => <div data-testid="references-page-mounted">references-page</div>,
}))
vi.mock("../pages/appearance-page", () => ({
  AppearancePage: () => <div data-testid="appearance-page-mounted">appearance-page</div>,
}))
vi.mock("../pages/time-of-day-page", () => ({
  TimeOfDayPage: () => <div data-testid="time-of-day-page-mounted">time-of-day-page</div>,
}))
vi.mock("../pages/weather-page", () => ({
  WeatherPage: () => <div data-testid="weather-page-mounted">weather-page</div>,
}))
vi.mock("../pages/seasons-page", () => ({
  SeasonsPage: () => <div data-testid="seasons-page-mounted">seasons-page</div>,
}))
vi.mock("../pages/angles-page", () => ({
  AnglesPage: () => <div data-testid="angles-page-mounted">angles-page</div>,
}))
vi.mock("../pages/lighting-page", () => ({
  LightingPage: () => <div data-testid="lighting-page-mounted">lighting-page</div>,
}))
vi.mock("../pages/motion-page", () => ({
  MotionPage: () => <div data-testid="motion-page-mounted">motion-page</div>,
}))
vi.mock("../pages/sheet-page", () => ({
  SheetPage: () => <div data-testid="sheet-page-mounted">sheet-page</div>,
}))

// The modal calls useAuth() (which internally calls useNavigate). These tests
// render the modal without a Router, so mock the auth hook to avoid the
// useNavigate throw. A non-admin result hides the "Share to community" button,
// leaving the header/tab assertions below unaffected. getCachedUserId is also
// exported here because the same module supplies it to the studio hooks.
vi.mock("@/hooks/use-auth", () => ({
  useAuth: () => ({ isAdmin: false }),
  getCachedUserId: () => "user-1",
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

  it("renders the header title from stagedData and opens on the Appearance page", () => {
    render(<LocationStudioModal nodeId="loc-1" onClose={() => {}} />)
    expect(screen.getByRole("heading", { name: /cafe roma/i })).toBeInTheDocument()
    expect(screen.getByTestId("appearance-page-mounted")).toBeInTheDocument()
    expect(screen.getByRole("dialog")).toHaveAttribute("aria-modal", "true")
  })

  it("renders 'Loading location…' placeholder when stagedData is null (cold-load)", () => {
    mockStudioState.stagedData = null
    render(<LocationStudioModal nodeId="loc-1" onClose={() => {}} />)
    expect(screen.getByText(/loading location/i)).toBeInTheDocument()
    expect(screen.queryByTestId("appearance-page-mounted")).not.toBeInTheDocument()
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

  it("renders all 9 sidebar page buttons (References + Appearance + 5 environmental/composition + Motion + Sheet)", () => {
    render(<LocationStudioModal nodeId="loc-1" onClose={() => {}} />)
    for (const label of [
      "References",
      "Appearance",
      "Time of Day",
      "Weather",
      "Seasons",
      "Angles",
      "Lighting",
      "Motion",
      "Sheet",
    ]) {
      expect(screen.getByRole("button", { name: new RegExp(label, "i") })).toBeInTheDocument()
    }
  })

  it("renders all 6 sidebar group headers (Resources / Identity / Environment / Composition / Atmosphere / Sheet)", () => {
    render(<LocationStudioModal nodeId="loc-1" onClose={() => {}} />)
    // First 5 group labels are unique. "Sheet" is shared by the group header
    // AND its single page button, so assert presence (≥1) instead of uniqueness.
    for (const label of ["Resources", "Identity", "Environment", "Composition", "Atmosphere"]) {
      expect(screen.getByText(new RegExp(`^${label}$`, "i"))).toBeInTheDocument()
    }
    expect(screen.getAllByText(/^Sheet$/i).length).toBeGreaterThanOrEqual(1)
  })

  it("promotes References to a first-class page and switches the body to it", () => {
    render(<LocationStudioModal nodeId="loc-1" onClose={() => {}} />)
    fireEvent.click(screen.getByRole("button", { name: /references/i }))
    expect(screen.getByTestId("references-page-mounted")).toBeInTheDocument()
    expect(screen.queryByTestId("appearance-page-mounted")).not.toBeInTheDocument()
  })

  it("clicking Time of Day swaps the body to the Time of Day page", () => {
    render(<LocationStudioModal nodeId="loc-1" onClose={() => {}} />)
    fireEvent.click(screen.getByRole("button", { name: /time of day/i }))
    expect(screen.getByTestId("time-of-day-page-mounted")).toBeInTheDocument()
    expect(screen.queryByTestId("appearance-page-mounted")).not.toBeInTheDocument()
  })

  it("clicking Weather swaps the body to the Weather page", () => {
    render(<LocationStudioModal nodeId="loc-1" onClose={() => {}} />)
    fireEvent.click(screen.getByRole("button", { name: /weather/i }))
    expect(screen.getByTestId("weather-page-mounted")).toBeInTheDocument()
  })

  it("clicking Seasons swaps the body to the Seasons page", () => {
    render(<LocationStudioModal nodeId="loc-1" onClose={() => {}} />)
    fireEvent.click(screen.getByRole("button", { name: /seasons/i }))
    expect(screen.getByTestId("seasons-page-mounted")).toBeInTheDocument()
  })

  it("clicking Angles swaps the body to the Angles page", () => {
    render(<LocationStudioModal nodeId="loc-1" onClose={() => {}} />)
    fireEvent.click(screen.getByRole("button", { name: /angles/i }))
    expect(screen.getByTestId("angles-page-mounted")).toBeInTheDocument()
  })

  it("clicking Lighting swaps the body to the Lighting page", () => {
    render(<LocationStudioModal nodeId="loc-1" onClose={() => {}} />)
    fireEvent.click(screen.getByRole("button", { name: /lighting/i }))
    expect(screen.getByTestId("lighting-page-mounted")).toBeInTheDocument()
  })

  it("clicking Motion swaps the body to the Motion page", () => {
    render(<LocationStudioModal nodeId="loc-1" onClose={() => {}} />)
    fireEvent.click(screen.getByRole("button", { name: /motion/i }))
    expect(screen.getByTestId("motion-page-mounted")).toBeInTheDocument()
  })

  it("clicking Sheet swaps the body to the Sheet page", () => {
    render(<LocationStudioModal nodeId="loc-1" onClose={() => {}} />)
    fireEvent.click(screen.getByRole("button", { name: /sheet/i }))
    expect(screen.getByTestId("sheet-page-mounted")).toBeInTheDocument()
  })

  it("shows count badges next to pages when the corresponding bucket has assets", () => {
    const data = mockStudioState.stagedData as Record<string, unknown>
    data.timeOfDay = [
      { id: "t1", url: "https://r2/t1.png", variant: "dawn" },
      { id: "t2", url: "https://r2/t2.png", variant: "dusk" },
    ]
    data.weather = [{ id: "w1", url: "https://r2/w1.png", variant: "rain" }]
    data.seasons = []
    data.angles = [
      { id: "a1", url: "https://r2/a1.png", variant: "wide" },
      { id: "a2", url: "https://r2/a2.png", variant: "close" },
      { id: "a3", url: "https://r2/a3.png", variant: "aerial" },
    ]
    data.lighting = []
    data.atmosphereMotions = [{ id: "m1", url: "https://r2/m1.mp4", variant: "wind" }]

    render(<LocationStudioModal nodeId="loc-1" onClose={() => {}} />)

    // Counts render as the shell's pill badge appended to the page label.
    expect(screen.getByRole("button", { name: /time of day.*2/i })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /weather.*1/i })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /angles.*3/i })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /motion.*1/i })).toBeInTheDocument()

    // Zero-count pages omit the badge digit entirely.
    expect(screen.getByRole("button", { name: /seasons/i }).textContent).not.toMatch(/\d/)
    expect(screen.getByRole("button", { name: /lighting/i }).textContent).not.toMatch(/\d/)
    // Appearance never shows a count (it's the identity page, not a list bucket).
    expect(screen.getByRole("button", { name: /appearance/i }).textContent).not.toMatch(/\d/)
  })
})
