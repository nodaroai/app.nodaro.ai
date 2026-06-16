import { describe, it, expect, vi } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"

// Stub the page modules to inert, uniquely-identified markers so this test
// exercises ONLY the nav config (groups / pages / badges / body switch) via
// the shared StudioShell — not the heavy tab internals (which have their own
// tests and pull in jobs hooks, Supabase realtime, etc.).
vi.mock("../pages/references-page", () => ({ ReferencesPage: () => <div>references-body</div> }))
vi.mock("../pages/appearance-page", () => ({ AppearancePage: () => <div>appearance-body</div> }))
vi.mock("../pages/angles-page", () => ({ AnglesPage: () => <div>angles-body</div> }))
vi.mock("../pages/materials-page", () => ({ MaterialsPage: () => <div>materials-body</div> }))
vi.mock("../pages/variations-page", () => ({ VariationsPage: () => <div>variations-body</div> }))
vi.mock("../pages/motion-page", () => ({ MotionPage: () => <div>motion-body</div> }))
vi.mock("../pages/sheet-page", () => ({ SheetPage: () => <div>sheet-body</div> }))

import { StudioShell } from "../../studio-shell/studio-shell"
import { OBJECT_STUDIO_NAV } from "../object-nav-config"
import type { ObjectStudioState } from "../use-object-studio"
import type { ObjectStudioJobs } from "../use-object-studio-jobs"

const stubJobs: ObjectStudioJobs = {
  tracked: [],
  trackJob: vi.fn(),
  beginJob: vi.fn(() => "optimistic:test"),
  settleJob: vi.fn(),
  abortJob: vi.fn(),
  onResolved: vi.fn(),
  onFailed: vi.fn(),
}

function makeState(stagedOverrides: Record<string, unknown> = {}): ObjectStudioState {
  return {
    stagedData: {
      angles: [],
      materials: [],
      variations: [],
      motionClips: [],
      sheets: [],
      referencePhotos: [],
      ...stagedOverrides,
    } as unknown as ObjectStudioState["stagedData"],
    isDirty: false,
    isSaving: false,
    isApprovingMainImage: false,
    setIsApprovingMainImage: vi.fn(),
    patch: vi.fn(),
    saveStaged: vi.fn(),
    ensureSavedBeforeGen: vi.fn(),
    approveMainImage: vi.fn(),
  } as unknown as ObjectStudioState
}

const renderNav = (state: ObjectStudioState) =>
  render(
    <StudioShell config={OBJECT_STUDIO_NAV} state={state} jobs={stubJobs} hasCredits defaultActiveKey="appearance" />,
  )

describe("OBJECT_STUDIO_NAV", () => {
  it("renders all 6 group labels", () => {
    renderNav(makeState())
    // The first 4 group labels are unique strings. "Motion" and "Sheet" are
    // each shared by the group header AND its single page button, so assert
    // they appear (≥1) via getAllByText rather than uniqueness-asserting getByText.
    for (const label of ["Resources", "Identity", "Composition", "Variants"]) {
      expect(screen.getByText(label)).toBeInTheDocument()
    }
    expect(screen.getAllByText("Motion").length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText("Sheet").length).toBeGreaterThanOrEqual(1)
  })

  it("renders every page button including the promoted References page", () => {
    renderNav(makeState())
    for (const label of [
      "References",
      "Appearance",
      "Angles",
      "Materials",
      "Variations",
      "Motion",
      "Sheet",
    ]) {
      expect(screen.getByRole("button", { name: new RegExp(label, "i") })).toBeInTheDocument()
    }
  })

  it("does NOT render location-only pages (Time of Day / Weather / Seasons / Lighting)", () => {
    renderNav(makeState())
    expect(screen.queryByRole("button", { name: /time of day/i })).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /weather/i })).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /seasons/i })).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /lighting/i })).not.toBeInTheDocument()
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
      [/angles/i, "angles-body"],
      [/materials/i, "materials-body"],
      [/variations/i, "variations-body"],
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
        angles: [{ id: "a1" }, { id: "a2" }],
        materials: [{ id: "m1" }],
        variations: [],
        motionClips: [{ id: "c1" }, { id: "c2" }, { id: "c3" }],
        sheets: [{ id: "s1" }],
      }),
    )
    expect(screen.getByRole("button", { name: /angles.*2/i })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /materials.*1/i })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /motion.*3/i })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /sheet.*1/i })).toBeInTheDocument()

    // Zero-count list pages render no badge digit.
    expect(screen.getByRole("button", { name: /variations/i }).textContent).not.toMatch(/\d/)
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
