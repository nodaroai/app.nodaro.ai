import { describe, it, expect, vi } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"

// Stub the page modules to inert, uniquely-identified markers so this test
// exercises ONLY the nav config (groups / pages / badges / body switch) via
// the shared StudioShell — not the heavy tab internals (which have their own
// tests and pull in jobs hooks, Supabase realtime, etc.).
vi.mock("../pages/references-page", () => ({ ReferencesPage: () => <div>references-body</div> }))
vi.mock("../pages/appearance-page", () => ({ AppearancePage: () => <div>appearance-body</div> }))
vi.mock("../pages/time-of-day-page", () => ({ TimeOfDayPage: () => <div>time-of-day-body</div> }))
vi.mock("../pages/weather-page", () => ({ WeatherPage: () => <div>weather-body</div> }))
vi.mock("../pages/seasons-page", () => ({ SeasonsPage: () => <div>seasons-body</div> }))
vi.mock("../pages/angles-page", () => ({ AnglesPage: () => <div>angles-body</div> }))
vi.mock("../pages/lighting-page", () => ({ LightingPage: () => <div>lighting-body</div> }))
vi.mock("../pages/motion-page", () => ({ MotionPage: () => <div>motion-body</div> }))
vi.mock("../pages/sheet-page", () => ({ SheetPage: () => <div>sheet-body</div> }))

import { StudioShell } from "../../studio-shell/studio-shell"
import { LOCATION_STUDIO_NAV } from "../location-nav-config"
import type { LocationStudioState } from "../use-location-studio"
import type { LocationStudioJobs } from "../use-location-studio-jobs"

const stubJobs: LocationStudioJobs = {
  tracked: [],
  trackJob: vi.fn(),
  beginJob: vi.fn(() => ""),
  settleJob: vi.fn(),
  abortJob: vi.fn(),
  onResolved: vi.fn(),
  onFailed: vi.fn(),
}

function makeState(stagedOverrides: Record<string, unknown> = {}): LocationStudioState {
  return {
    stagedData: {
      timeOfDay: [],
      weather: [],
      seasons: [],
      angles: [],
      lighting: [],
      atmosphereMotions: [],
      sheets: [],
      referencePhotos: [],
      ...stagedOverrides,
    } as unknown as LocationStudioState["stagedData"],
    isDirty: false,
    isSaving: false,
    isApprovingMainImage: false,
    setIsApprovingMainImage: vi.fn(),
    patch: vi.fn(),
    saveStaged: vi.fn(),
    ensureSavedBeforeGen: vi.fn(),
    approveMainImage: vi.fn(),
  } as unknown as LocationStudioState

}

const renderNav = (state: LocationStudioState) =>
  render(
    <StudioShell config={LOCATION_STUDIO_NAV} state={state} jobs={stubJobs} hasCredits defaultActiveKey="appearance" />,
  )

describe("LOCATION_STUDIO_NAV", () => {
  it("renders all 6 group labels", () => {
    renderNav(makeState())
    // The first 5 group labels are unique strings. "Sheet" is shared by the
    // group header AND its single page button, so assert it appears (≥1) via
    // getAllByText rather than the uniqueness-asserting getByText.
    for (const label of ["Resources", "Identity", "Environment", "Composition", "Atmosphere"]) {
      expect(screen.getByText(label)).toBeInTheDocument()
    }
    expect(screen.getAllByText("Sheet").length).toBeGreaterThanOrEqual(1)
  })

  it("renders every page button including the promoted References page", () => {
    renderNav(makeState())
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

  it("opens on the Appearance page by default", () => {
    renderNav(makeState())
    expect(screen.getByText("appearance-body")).toBeInTheDocument()
    expect(screen.queryByText("references-body")).not.toBeInTheDocument()
  })

  it("switches to the References page on click", () => {
    renderNav(makeState())
    fireEvent.click(screen.getByRole("button", { name: /references/i }))
    expect(screen.getByText("references-body")).toBeInTheDocument()
    expect(screen.queryByText("appearance-body")).not.toBeInTheDocument()
  })

  it("switches body for each content page", () => {
    renderNav(makeState())
    const cases: Array<[RegExp, string]> = [
      [/time of day/i, "time-of-day-body"],
      [/weather/i, "weather-body"],
      [/seasons/i, "seasons-body"],
      [/angles/i, "angles-body"],
      [/lighting/i, "lighting-body"],
      [/motion/i, "motion-body"],
      [/sheet/i, "sheet-body"],
    ]
    for (const [name, body] of cases) {
      fireEvent.click(screen.getByRole("button", { name }))
      expect(screen.getByText(body)).toBeInTheDocument()
    }
  })

  it("shows count badges for list-bucket pages and omits them at zero", () => {
    renderNav(
      makeState({
        timeOfDay: [{ id: "t1" }, { id: "t2" }],
        weather: [{ id: "w1" }],
        angles: [{ id: "a1" }, { id: "a2" }, { id: "a3" }],
        atmosphereMotions: [{ id: "m1" }],
        sheets: [{ id: "s1" }],
        seasons: [],
        lighting: [],
      }),
    )
    expect(screen.getByRole("button", { name: /time of day.*2/i })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /weather.*1/i })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /angles.*3/i })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /motion.*1/i })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /sheet.*1/i })).toBeInTheDocument()

    // Zero-count list pages render no badge digit.
    expect(screen.getByRole("button", { name: /seasons/i }).textContent).not.toMatch(/\d/)
    expect(screen.getByRole("button", { name: /lighting/i }).textContent).not.toMatch(/\d/)
    // Appearance + References are not list buckets — no badge ever.
    expect(screen.getByRole("button", { name: /appearance/i }).textContent).not.toMatch(/\d/)
    expect(screen.getByRole("button", { name: /references/i }).textContent).not.toMatch(/\d/)
  })

  it("applies the cyan accent class to the active page button", () => {
    renderNav(makeState())
    const active = screen.getByRole("button", { name: /appearance/i })
    expect(active.className).toContain("#22d3ee")
  })
})
