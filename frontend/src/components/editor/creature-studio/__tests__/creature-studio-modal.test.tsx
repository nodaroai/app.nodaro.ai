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

// Stub the 5 tab modules so the test doesn't depend on their internals.
vi.mock("../appearance-tab", () => ({
  AppearanceTab: () => <div data-testid="appearance-tab-mounted">appearance-tab</div>,
}))
vi.mock("../angles-tab", () => ({
  AnglesTab: () => <div data-testid="angles-tab-mounted">angles-tab</div>,
}))
vi.mock("../poses-tab", () => ({
  PosesTab: () => <div data-testid="poses-tab-mounted">poses-tab</div>,
}))
vi.mock("../variations-tab", () => ({
  VariationsTab: () => <div data-testid="variations-tab-mounted">variations-tab</div>,
}))
vi.mock("../motion-tab", () => ({
  MotionTab: () => <div data-testid="motion-tab-mounted">motion-tab</div>,
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

// The realtime hook builds a Supabase client (createClient() →
// channel().on().subscribe()). The real client construction reads
// VITE_SUPABASE_URL (unset in tests) and throws "supabaseUrl is required".
// Stub an inert client — this modal-shell test doesn't exercise realtime,
// which is covered in location-studio/use-jobs-realtime-sync.test.tsx.
vi.mock("@/lib/supabase", () => {
  const channel = { on: () => channel, subscribe: () => channel }
  return {
    createClient: () => ({ channel: () => channel, removeChannel: () => {} }),
  }
})

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

  it("renders the header title from stagedData and mounts the Appearance tab", () => {
    render(<CreatureStudioModal nodeId="cre-1" onClose={() => {}} />)
    expect(screen.getByRole("heading", { name: /ember fox/i })).toBeInTheDocument()
    expect(screen.getByTestId("appearance-tab-mounted")).toBeInTheDocument()
    expect(screen.getByRole("dialog")).toHaveAttribute("aria-modal", "true")
  })

  it("renders 'Loading creature…' placeholder when stagedData is null (cold-load)", () => {
    mockStudioState.stagedData = null
    render(<CreatureStudioModal nodeId="cre-1" onClose={() => {}} />)
    expect(screen.getByText(/loading creature/i)).toBeInTheDocument()
    expect(screen.queryByTestId("appearance-tab-mounted")).not.toBeInTheDocument()
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

  it("renders all 5 sidebar tab buttons (Appearance, Angles, Poses, Variations, Motion)", () => {
    render(<CreatureStudioModal nodeId="cre-1" onClose={() => {}} />)
    expect(screen.getByRole("button", { name: /appearance/i })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /angles/i })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /poses/i })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /variations/i })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /motion/i })).toBeInTheDocument()
  })

  it("does NOT render the deferred Sheet tab or object-only Materials tab", () => {
    render(<CreatureStudioModal nodeId="cre-1" onClose={() => {}} />)
    expect(screen.queryByRole("button", { name: /sheet/i })).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /materials/i })).not.toBeInTheDocument()
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

  it("renders 4 sidebar section headers (Identity / Composition / Variants / Motion)", () => {
    render(<CreatureStudioModal nodeId="cre-1" onClose={() => {}} />)
    expect(screen.getByText(/^identity$/i)).toBeInTheDocument()
    expect(screen.getByText(/^composition$/i)).toBeInTheDocument()
    expect(screen.getByText(/^variants$/i)).toBeInTheDocument()
    // "Motion" appears both as a section header and a tab button — assert at
    // least one match.
    expect(screen.getAllByText(/^motion$/i).length).toBeGreaterThanOrEqual(1)
  })

  it("defaults to the Appearance tab body", () => {
    render(<CreatureStudioModal nodeId="cre-1" onClose={() => {}} />)
    expect(screen.getByTestId("appearance-tab-mounted")).toBeInTheDocument()
    expect(screen.queryByTestId("angles-tab-mounted")).not.toBeInTheDocument()
  })

  it("clicking Angles swaps the body to the Angles tab", () => {
    render(<CreatureStudioModal nodeId="cre-1" onClose={() => {}} />)
    fireEvent.click(screen.getByRole("button", { name: /angles/i }))
    expect(screen.getByTestId("angles-tab-mounted")).toBeInTheDocument()
    expect(screen.queryByTestId("appearance-tab-mounted")).not.toBeInTheDocument()
  })

  it("clicking Poses swaps the body to the Poses tab", () => {
    render(<CreatureStudioModal nodeId="cre-1" onClose={() => {}} />)
    fireEvent.click(screen.getByRole("button", { name: /poses/i }))
    expect(screen.getByTestId("poses-tab-mounted")).toBeInTheDocument()
  })

  it("clicking Variations swaps the body to the Variations tab", () => {
    render(<CreatureStudioModal nodeId="cre-1" onClose={() => {}} />)
    fireEvent.click(screen.getByRole("button", { name: /variations/i }))
    expect(screen.getByTestId("variations-tab-mounted")).toBeInTheDocument()
  })

  it("clicking Motion swaps the body to the Motion tab", () => {
    render(<CreatureStudioModal nodeId="cre-1" onClose={() => {}} />)
    fireEvent.click(screen.getByRole("button", { name: /motion/i }))
    expect(screen.getByTestId("motion-tab-mounted")).toBeInTheDocument()
  })

  it("shows count badges next to tabs when the corresponding bucket has assets", () => {
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

    expect(screen.getByRole("button", { name: /angles.*\(2\)/i })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /poses.*\(1\)/i })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /motion.*\(3\)/i })).toBeInTheDocument()
    // Zero-count tabs omit the parenthetical entirely.
    expect(screen.getByRole("button", { name: /variations/i }).textContent).not.toMatch(/\(/)
    // Appearance never shows a count.
    expect(screen.getByRole("button", { name: /appearance/i }).textContent).not.toMatch(/\(/)
  })
})
