import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"

// Stub the studio hook — the actual hook is covered in its own test file.
// Here we only need to drive the modal shell. `vi.hoisted` lifts the mock
// state (which carries `vi.fn()`s) above the `vi.mock` factory that
// references it, so the factory closure sees a fully-constructed object.
const mockStudioState = vi.hoisted(() => ({
  stagedData: {
    label: "Animal/Creature",
    creatureDbId: "",
    creatureName: "Ember Fox",
    description: "",
    species: "red fox",
    category: "",
    style: "realistic",
    sourceImageUrl: "",
    projectId: "proj-1",
    createdAt: "",
    executionStatus: "idle",
    generatedResults: [],
    activeResultIndex: 0,
    fieldMappings: {},
    angles: [],
    poses: [],
    variations: [],
    motionClips: [],
    referencePhotos: [],
    voice: null,
    canonicalDescription: "",
    styleLock: false,
    anglesStatus: "idle",
    posesStatus: "idle",
    variationsStatus: "idle",
    motionStatus: "idle",
    customVariations: [],
  } as unknown as Record<string, unknown> | null,
  isDirty: false,
  isSaving: false,
  isApprovingMainImage: false,
  setIsApprovingMainImage: vi.fn(),
  patch: vi.fn(),
  saveStaged: vi.fn().mockResolvedValue("uuid-1"),
  ensureSavedBeforeGen: vi.fn().mockResolvedValue("uuid-1"),
  approveMainImage: vi.fn().mockResolvedValue({
    sourceImageUrl: "",
    canonicalDescription: "",
  }),
}))
vi.mock("../use-creature-studio", () => ({
  useCreatureStudio: () => mockStudioState,
}))

// The Appearance page's main-image candidate jobs hook now mounts at MODAL
// scope (via useCreatureCandidates). Stub it inert so the realtime subscription
// effect never opens a Supabase channel in this modal-shell test — the
// AppearancePage body is mocked to a marker below, so the candidate UI itself
// isn't exercised here.
vi.mock("../use-creature-studio-jobs", () => ({
  useCreatureStudioJobs: () => ({
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
vi.mock("../pages/angles-page", () => ({
  AnglesPage: () => <div data-testid="angles-page-mounted">angles-page</div>,
}))
vi.mock("../pages/poses-page", () => ({
  PosesPage: () => <div data-testid="poses-page-mounted">poses-page</div>,
}))
vi.mock("../pages/variations-page", () => ({
  VariationsPage: () => <div data-testid="variations-page-mounted">variations-page</div>,
}))
vi.mock("../pages/motion-page", () => ({
  MotionPage: () => <div data-testid="motion-page-mounted">motion-page</div>,
}))
vi.mock("../pages/voice-page", () => ({
  VoicePage: () => <div data-testid="voice-page-mounted">voice-page</div>,
}))

// The modal stack calls useAuth() (which internally calls useNavigate) via the
// studio hooks. These tests render the modal without a Router, so mock the auth
// hook to avoid the useNavigate throw. getCachedUserId is also exported here
// because the same module supplies it to the studio hooks.
//
// `isAdmin` defaults to true (mutable per-test via `mockAuth`) because the
// "Share to community" button is gated on `isAdmin && isMultiUser()` — the
// positive share-button test below mirrors object-studio's affordance.
const mockAuth = vi.hoisted(() => ({ isAdmin: true }))
vi.mock("@/hooks/use-auth", () => ({
  useAuth: () => mockAuth,
  getCachedUserId: () => "user-1",
}))

// The "Share to community" button is also gated on `isMultiUser()` (business +
// cloud editions). Tests run with the default community edition, so force it
// true so the share affordance renders.
vi.mock("@/lib/edition", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/edition")>()
  return { ...actual, isMultiUser: () => true }
})

// The Share button opens a lazy-loaded PublishDialog from `@/ee/...`. Stub it
// inert so this modal-shell test doesn't pull the ee community surface (and its
// API client) into the render tree. Publishing is covered elsewhere.
vi.mock("@/ee/components/community/publish-dialog", () => ({
  default: () => null,
}))

import { CreatureStudioModal } from "../creature-studio-modal"

const defaultStagedData = () =>
  ({
    label: "Animal/Creature",
    creatureDbId: "",
    creatureName: "Ember Fox",
    description: "",
    species: "red fox",
    category: "",
    style: "realistic",
    sourceImageUrl: "",
    projectId: "proj-1",
    createdAt: "",
    executionStatus: "idle",
    generatedResults: [],
    activeResultIndex: 0,
    fieldMappings: {},
    angles: [],
    poses: [],
    variations: [],
    motionClips: [],
    referencePhotos: [],
    voice: null,
    canonicalDescription: "",
    styleLock: false,
    anglesStatus: "idle",
    posesStatus: "idle",
    variationsStatus: "idle",
    motionStatus: "idle",
    customVariations: [],
  }) as unknown as Record<string, unknown>

describe("CreatureStudioModal", () => {
  beforeEach(() => {
    mockStudioState.stagedData = defaultStagedData()
    mockStudioState.isDirty = false
    mockStudioState.isSaving = false
    mockStudioState.isApprovingMainImage = false
    mockAuth.isAdmin = true
    vi.clearAllMocks()
    mockStudioState.saveStaged = vi.fn().mockResolvedValue("uuid-1")
    mockStudioState.ensureSavedBeforeGen = vi.fn().mockResolvedValue("uuid-1")
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("renders the header title from stagedData and opens on the Appearance page", () => {
    render(<CreatureStudioModal nodeId="cre-1" onClose={() => {}} />)
    expect(screen.getByRole("heading", { name: /ember fox/i })).toBeInTheDocument()
    expect(screen.getByTestId("appearance-page-mounted")).toBeInTheDocument()
    expect(screen.getByRole("dialog")).toHaveAttribute("aria-modal", "true")
  })

  it("renders 'Loading creature…' placeholder when stagedData is null (cold-load)", () => {
    mockStudioState.stagedData = null
    render(<CreatureStudioModal nodeId="cre-1" onClose={() => {}} />)
    expect(screen.getByText(/loading creature/i)).toBeInTheDocument()
    expect(screen.queryByTestId("appearance-page-mounted")).not.toBeInTheDocument()
  })

  it("Escape closes when not dirty (no confirm)", () => {
    const onClose = vi.fn()
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true)
    render(<CreatureStudioModal nodeId="cre-1" onClose={onClose} />)
    fireEvent.keyDown(window, { key: "Escape" })
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(confirmSpy).not.toHaveBeenCalled()
  })

  it("Escape prompts via window.confirm when dirty; cancel keeps modal open", () => {
    mockStudioState.isDirty = true
    const onClose = vi.fn()
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false)
    render(<CreatureStudioModal nodeId="cre-1" onClose={onClose} />)
    fireEvent.keyDown(window, { key: "Escape" })
    expect(confirmSpy).toHaveBeenCalledWith("Discard unsaved changes?")
    expect(onClose).not.toHaveBeenCalled()
  })

  it("Save button is disabled when not dirty and enabled when dirty", () => {
    mockStudioState.isDirty = false
    const { rerender } = render(<CreatureStudioModal nodeId="cre-1" onClose={() => {}} />)
    expect(screen.getByRole("button", { name: /^save$/i })).toBeDisabled()

    mockStudioState.isDirty = true
    rerender(<CreatureStudioModal nodeId="cre-1" onClose={() => {}} />)
    expect(screen.getByRole("button", { name: /^save$/i })).not.toBeDisabled()
  })

  it("Close button is disabled while saving", () => {
    mockStudioState.isSaving = true
    render(<CreatureStudioModal nodeId="cre-1" onClose={() => {}} />)
    expect(screen.getByRole("button", { name: /close/i })).toBeDisabled()
  })

  it("Style Lock toggle calls patch with the new value", () => {
    render(<CreatureStudioModal nodeId="cre-1" onClose={() => {}} />)
    const toggle = screen.getByRole("checkbox", { name: /style lock/i })
    fireEvent.click(toggle)
    expect(mockStudioState.patch).toHaveBeenCalledWith({ styleLock: true })
  })

  it("renders all 7 sidebar page buttons (References + Appearance + Angles + Poses + Variations + Motion + Voice)", () => {
    render(<CreatureStudioModal nodeId="cre-1" onClose={() => {}} />)
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

  it("does NOT render the deferred Sheet page or object-only Materials page", () => {
    render(<CreatureStudioModal nodeId="cre-1" onClose={() => {}} />)
    expect(screen.queryByRole("button", { name: /sheet/i })).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /materials/i })).not.toBeInTheDocument()
  })

  it("does NOT render location-only pages (Time of Day / Weather / Seasons / Lighting)", () => {
    render(<CreatureStudioModal nodeId="cre-1" onClose={() => {}} />)
    expect(screen.queryByRole("button", { name: /time of day/i })).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /weather/i })).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /seasons/i })).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /lighting/i })).not.toBeInTheDocument()
  })

  it("renders all 6 sidebar group headers (Resources / Identity / Composition / Variants / Motion / Character)", () => {
    render(<CreatureStudioModal nodeId="cre-1" onClose={() => {}} />)
    // Resources / Identity / Composition / Variants / Character are unique
    // strings. "Motion" is shared by a group header AND a page button, so
    // assert presence (≥1) rather than uniqueness.
    for (const label of ["Resources", "Identity", "Composition", "Variants", "Character"]) {
      expect(screen.getByText(new RegExp(`^${label}$`, "i"))).toBeInTheDocument()
    }
    expect(screen.getAllByText(/^Motion$/i).length).toBeGreaterThanOrEqual(1)
  })

  it("promotes References to a first-class page and switches the body to it", () => {
    render(<CreatureStudioModal nodeId="cre-1" onClose={() => {}} />)
    fireEvent.click(screen.getByRole("button", { name: /references/i }))
    expect(screen.getByTestId("references-page-mounted")).toBeInTheDocument()
    expect(screen.queryByTestId("appearance-page-mounted")).not.toBeInTheDocument()
  })

  it("defaults to the Appearance page body", () => {
    render(<CreatureStudioModal nodeId="cre-1" onClose={() => {}} />)
    expect(screen.getByTestId("appearance-page-mounted")).toBeInTheDocument()
    expect(screen.queryByTestId("angles-page-mounted")).not.toBeInTheDocument()
  })

  it("clicking Angles swaps the body to the Angles page", () => {
    render(<CreatureStudioModal nodeId="cre-1" onClose={() => {}} />)
    fireEvent.click(screen.getByRole("button", { name: /angles/i }))
    expect(screen.getByTestId("angles-page-mounted")).toBeInTheDocument()
    expect(screen.queryByTestId("appearance-page-mounted")).not.toBeInTheDocument()
  })

  it("clicking Poses swaps the body to the Poses page", () => {
    render(<CreatureStudioModal nodeId="cre-1" onClose={() => {}} />)
    fireEvent.click(screen.getByRole("button", { name: /poses/i }))
    expect(screen.getByTestId("poses-page-mounted")).toBeInTheDocument()
  })

  it("clicking Variations swaps the body to the Variations page", () => {
    render(<CreatureStudioModal nodeId="cre-1" onClose={() => {}} />)
    fireEvent.click(screen.getByRole("button", { name: /variations/i }))
    expect(screen.getByTestId("variations-page-mounted")).toBeInTheDocument()
  })

  it("clicking Motion swaps the body to the Motion page", () => {
    render(<CreatureStudioModal nodeId="cre-1" onClose={() => {}} />)
    fireEvent.click(screen.getByRole("button", { name: /motion/i }))
    expect(screen.getByTestId("motion-page-mounted")).toBeInTheDocument()
  })

  it("clicking Voice swaps the body to the Voice page (talking creature)", () => {
    render(<CreatureStudioModal nodeId="cre-1" onClose={() => {}} />)
    fireEvent.click(screen.getByRole("button", { name: /voice/i }))
    expect(screen.getByTestId("voice-page-mounted")).toBeInTheDocument()
  })

  it("shows a ✓ check badge on the Voice page once a voice is set", () => {
    const data = mockStudioState.stagedData as Record<string, unknown>
    data.voice = { voiceId: "vid_1", voiceName: "Growler", traits: "" }
    render(<CreatureStudioModal nodeId="cre-1" onClose={() => {}} />)
    expect(screen.getByRole("button", { name: /voice.*✓/i })).toBeInTheDocument()
  })

  it("shows count badges next to pages when the corresponding bucket has assets", () => {
    const data = mockStudioState.stagedData as Record<string, unknown>
    data.angles = [
      { name: "front", url: "https://r2/a.png" },
      { name: "side", url: "https://r2/b.png" },
    ]
    data.poses = [{ name: "standing", url: "https://r2/p.png" }]
    data.variations = []
    data.motionClips = [
      { name: "walk-cycle", url: "https://r2/c.mp4" },
      { name: "run-cycle", url: "https://r2/d.mp4" },
      { name: "idle-breathing", url: "https://r2/e.mp4" },
    ]

    render(<CreatureStudioModal nodeId="cre-1" onClose={() => {}} />)

    // Counts render as the shell's pill badge appended to the page label.
    expect(screen.getByRole("button", { name: /angles.*2/i })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /poses.*1/i })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /motion.*3/i })).toBeInTheDocument()
    // Zero-count pages omit the badge digit entirely.
    expect(screen.getByRole("button", { name: /variations/i }).textContent).not.toMatch(/\d/)
    // Appearance + References never show a count (not list buckets).
    expect(screen.getByRole("button", { name: /appearance/i }).textContent).not.toMatch(/\d/)
    expect(screen.getByRole("button", { name: /references/i }).textContent).not.toMatch(/\d/)
  })

  it("renders the 'Share to community' affordance for an admin in a multi-user edition", () => {
    render(<CreatureStudioModal nodeId="cre-1" onClose={() => {}} />)
    expect(
      screen.getByRole("button", { name: /share to community/i }),
    ).toBeInTheDocument()
  })

  it("Share button is disabled until the creature is saved (no creatureDbId)", () => {
    const data = mockStudioState.stagedData as Record<string, unknown>
    data.creatureDbId = ""
    render(<CreatureStudioModal nodeId="cre-1" onClose={() => {}} />)
    expect(screen.getByRole("button", { name: /share to community/i })).toBeDisabled()
  })

  it("Share button is enabled once the creature is saved (creatureDbId present)", () => {
    const data = mockStudioState.stagedData as Record<string, unknown>
    data.creatureDbId = "creature-uuid-1"
    render(<CreatureStudioModal nodeId="cre-1" onClose={() => {}} />)
    expect(
      screen.getByRole("button", { name: /share to community/i }),
    ).not.toBeDisabled()
  })

  it("hides the 'Share to community' affordance for a non-admin", () => {
    mockAuth.isAdmin = false
    render(<CreatureStudioModal nodeId="cre-1" onClose={() => {}} />)
    expect(
      screen.queryByRole("button", { name: /share to community/i }),
    ).not.toBeInTheDocument()
  })
})
