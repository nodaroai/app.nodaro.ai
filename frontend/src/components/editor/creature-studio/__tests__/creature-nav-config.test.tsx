import { describe, it, expect, vi } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"

// Stub the page modules to inert, uniquely-identified markers so this test
// exercises ONLY the nav config (groups / pages / badges / body switch) via
// the shared StudioShell — not the heavy tab internals (which have their own
// tests and pull in jobs hooks, Supabase realtime, etc.).
vi.mock("../pages/references-page", () => ({ ReferencesPage: () => <div>references-body</div> }))
vi.mock("../pages/appearance-page", () => ({ AppearancePage: () => <div>appearance-body</div> }))
vi.mock("../pages/angles-page", () => ({ AnglesPage: () => <div>angles-body</div> }))
vi.mock("../pages/poses-page", () => ({ PosesPage: () => <div>poses-body</div> }))
vi.mock("../pages/variations-page", () => ({ VariationsPage: () => <div>variations-body</div> }))
vi.mock("../pages/motion-page", () => ({ MotionPage: () => <div>motion-body</div> }))
vi.mock("../pages/voice-page", () => ({ VoicePage: () => <div>voice-body</div> }))

import { StudioShell } from "../../studio-shell/studio-shell"
import { CREATURE_STUDIO_NAV } from "../creature-nav-config"
import type { CreatureStudioState } from "../use-creature-studio"
import type { CreatureStudioJobs } from "../use-creature-studio-jobs"

const stubJobs: CreatureStudioJobs = {
  tracked: [],
  trackJob: vi.fn(),
  onResolved: vi.fn(),
  onFailed: vi.fn(),
}

function makeState(stagedOverrides: Record<string, unknown> = {}): CreatureStudioState {
  return {
    stagedData: {
      angles: [],
      poses: [],
      variations: [],
      motionClips: [],
      referencePhotos: [],
      voice: null,
      ...stagedOverrides,
    } as unknown as CreatureStudioState["stagedData"],
    isDirty: false,
    isSaving: false,
    isApprovingMainImage: false,
    setIsApprovingMainImage: vi.fn(),
    patch: vi.fn(),
    saveStaged: vi.fn(),
    ensureSavedBeforeGen: vi.fn(),
    approveMainImage: vi.fn(),
  } as unknown as CreatureStudioState
}

const renderNav = (state: CreatureStudioState) =>
  render(
    <StudioShell config={CREATURE_STUDIO_NAV} state={state} jobs={stubJobs} hasCredits defaultActiveKey="appearance" />,
  )

describe("CREATURE_STUDIO_NAV", () => {
  it("renders all 6 group labels", () => {
    renderNav(makeState())
    // Resources / Identity / Composition / Variants / Character are unique
    // strings. "Motion" is shared by the group header AND its single page
    // button, so assert it appears (≥1) via getAllByText.
    for (const label of ["Resources", "Identity", "Composition", "Variants", "Character"]) {
      expect(screen.getByText(label)).toBeInTheDocument()
    }
    expect(screen.getAllByText("Motion").length).toBeGreaterThanOrEqual(1)
  })

  it("renders every page button including the promoted References page and the Voice page", () => {
    renderNav(makeState())
    for (const label of [
      "References",
      "Appearance",
      "Angles",
      "Poses",
      "Variations",
      "Motion",
      "Voice",
    ]) {
      expect(screen.getByRole("button", { name: new RegExp(label, "i") })).toBeInTheDocument()
    }
  })

  it("does NOT render object/location-only pages (Materials / Sheet / Time of Day / Weather / Seasons / Lighting)", () => {
    renderNav(makeState())
    expect(screen.queryByRole("button", { name: /materials/i })).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /sheet/i })).not.toBeInTheDocument()
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
      [/poses/i, "poses-body"],
      [/variations/i, "variations-body"],
      [/motion/i, "motion-body"],
      [/voice/i, "voice-body"],
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
        poses: [{ id: "p1" }],
        variations: [],
        motionClips: [{ id: "c1" }, { id: "c2" }, { id: "c3" }],
      }),
    )
    expect(screen.getByRole("button", { name: /angles.*2/i })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /poses.*1/i })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /motion.*3/i })).toBeInTheDocument()

    // Zero-count list pages render no badge digit.
    expect(screen.getByRole("button", { name: /variations/i }).textContent).not.toMatch(/\d/)
    // Appearance + References are not list buckets — no badge ever.
    expect(screen.getByRole("button", { name: /appearance/i }).textContent).not.toMatch(/\d/)
    expect(screen.getByRole("button", { name: /references/i }).textContent).not.toMatch(/\d/)
  })

  it("shows a ✓ check badge on the Voice page only when a voice is set", () => {
    // No voice → no check.
    const { unmount } = renderNav(makeState({ voice: null }))
    expect(screen.getByRole("button", { name: /voice/i }).textContent).not.toMatch(/✓/)
    unmount()

    // Voice set → ✓.
    renderNav(makeState({ voice: { voiceId: "vid_1", voiceName: "Growler", traits: "" } }))
    expect(screen.getByRole("button", { name: /voice.*✓/i })).toBeInTheDocument()
  })

  it("applies the purple accent class to the active page button", () => {
    renderNav(makeState())
    const active = screen.getByRole("button", { name: /appearance/i })
    expect(active.className).toContain("#A78BFA")
  })
})
