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

// Stub the 7 tab modules so the test doesn't depend on their internals.
// Each renders a uniquely-id'd marker we can assert on to confirm body
// switching.
vi.mock("../appearance-tab", () => ({
  AppearanceTab: () => <div data-testid="appearance-tab-mounted">appearance-tab</div>,
}))
vi.mock("../time-of-day-tab", () => ({
  TimeOfDayTab: () => <div data-testid="time-of-day-tab-mounted">time-of-day-tab</div>,
}))
vi.mock("../weather-tab", () => ({
  WeatherTab: () => <div data-testid="weather-tab-mounted">weather-tab</div>,
}))
vi.mock("../seasons-tab", () => ({
  SeasonsTab: () => <div data-testid="seasons-tab-mounted">seasons-tab</div>,
}))
vi.mock("../angles-tab", () => ({
  AnglesTab: () => <div data-testid="angles-tab-mounted">angles-tab</div>,
}))
vi.mock("../lighting-tab", () => ({
  LightingTab: () => <div data-testid="lighting-tab-mounted">lighting-tab</div>,
}))
vi.mock("../motion-tab", () => ({
  MotionTab: () => <div data-testid="motion-tab-mounted">motion-tab</div>,
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

// The modal mounts a studio-jobs hook whose realtime path calls
// createClient() → channel().on().subscribe(). With getCachedUserId() stubbed
// truthy above, that effect fires on mount; the real client construction reads
// VITE_SUPABASE_URL (unset in tests) and throws "supabaseUrl is required". Stub
// an inert client — this modal-shell test doesn't exercise realtime, which is
// covered in use-jobs-realtime-sync.test.tsx.
vi.mock("@/lib/supabase", () => {
  const channel = { on: () => channel, subscribe: () => channel }
  return {
    createClient: () => ({ channel: () => channel, removeChannel: () => {} }),
  }
})

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

  it("renders all 7 sidebar tab buttons (Appearance, Time of Day, Weather, Seasons, Angles, Lighting, Motion)", () => {
    render(<LocationStudioModal nodeId="loc-1" onClose={() => {}} />)
    expect(screen.getByRole("button", { name: /appearance/i })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /time of day/i })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /weather/i })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /seasons/i })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /angles/i })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /lighting/i })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /motion/i })).toBeInTheDocument()
  })

  it("renders all 4 sidebar section headers (Identity / Environment / Composition / Atmosphere)", () => {
    render(<LocationStudioModal nodeId="loc-1" onClose={() => {}} />)
    expect(screen.getByText(/^identity$/i)).toBeInTheDocument()
    expect(screen.getByText(/^environment$/i)).toBeInTheDocument()
    expect(screen.getByText(/^composition$/i)).toBeInTheDocument()
    expect(screen.getByText(/^atmosphere$/i)).toBeInTheDocument()
  })

  it("no longer shows the PR-1 'More tabs in PR-2' placeholder", () => {
    render(<LocationStudioModal nodeId="loc-1" onClose={() => {}} />)
    expect(screen.queryByText(/more tabs in pr-2/i)).not.toBeInTheDocument()
  })

  it("defaults to the Appearance tab body", () => {
    render(<LocationStudioModal nodeId="loc-1" onClose={() => {}} />)
    expect(screen.getByTestId("appearance-tab-mounted")).toBeInTheDocument()
    expect(screen.queryByTestId("time-of-day-tab-mounted")).not.toBeInTheDocument()
  })

  it("clicking Time of Day swaps the body to the Time of Day tab", () => {
    render(<LocationStudioModal nodeId="loc-1" onClose={() => {}} />)
    fireEvent.click(screen.getByRole("button", { name: /time of day/i }))
    expect(screen.getByTestId("time-of-day-tab-mounted")).toBeInTheDocument()
    expect(screen.queryByTestId("appearance-tab-mounted")).not.toBeInTheDocument()
  })

  it("clicking Weather swaps the body to the Weather tab", () => {
    render(<LocationStudioModal nodeId="loc-1" onClose={() => {}} />)
    fireEvent.click(screen.getByRole("button", { name: /weather/i }))
    expect(screen.getByTestId("weather-tab-mounted")).toBeInTheDocument()
  })

  it("clicking Seasons swaps the body to the Seasons tab", () => {
    render(<LocationStudioModal nodeId="loc-1" onClose={() => {}} />)
    fireEvent.click(screen.getByRole("button", { name: /seasons/i }))
    expect(screen.getByTestId("seasons-tab-mounted")).toBeInTheDocument()
  })

  it("clicking Angles swaps the body to the Angles tab", () => {
    render(<LocationStudioModal nodeId="loc-1" onClose={() => {}} />)
    fireEvent.click(screen.getByRole("button", { name: /angles/i }))
    expect(screen.getByTestId("angles-tab-mounted")).toBeInTheDocument()
  })

  it("clicking Lighting swaps the body to the Lighting tab", () => {
    render(<LocationStudioModal nodeId="loc-1" onClose={() => {}} />)
    fireEvent.click(screen.getByRole("button", { name: /lighting/i }))
    expect(screen.getByTestId("lighting-tab-mounted")).toBeInTheDocument()
  })

  it("clicking Motion swaps the body to the Motion tab", () => {
    render(<LocationStudioModal nodeId="loc-1" onClose={() => {}} />)
    fireEvent.click(screen.getByRole("button", { name: /motion/i }))
    expect(screen.getByTestId("motion-tab-mounted")).toBeInTheDocument()
  })

  it("shows count badges next to tabs when the corresponding bucket has assets", () => {
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

    // Counts render in-line with the tab label.
    expect(screen.getByRole("button", { name: /time of day.*\(2\)/i })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /weather.*\(1\)/i })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /angles.*\(3\)/i })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /motion.*\(1\)/i })).toBeInTheDocument()

    // Zero-count tabs omit the parenthetical entirely.
    expect(screen.getByRole("button", { name: /seasons/i }).textContent).not.toMatch(/\(/)
    expect(screen.getByRole("button", { name: /lighting/i }).textContent).not.toMatch(/\(/)
    // Appearance never shows a count (it's the identity tab, not a list bucket).
    expect(screen.getByRole("button", { name: /appearance/i }).textContent).not.toMatch(/\(/)
  })
})
