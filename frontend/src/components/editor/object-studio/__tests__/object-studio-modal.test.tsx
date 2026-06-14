import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"

// Stub the studio hook — the actual hook is covered in its own test file.
// Here we only need to drive the modal shell.
const mockStudioState = {
  stagedData: {
    label: "Object",
    objectDbId: "",
    objectName: "Vintage Lamp",
    description: "",
    category: "other",
    style: "realistic",
    sourceImageUrl: "",
    projectId: "proj-1",
    createdAt: "",
    executionStatus: "idle",
    generatedResults: [],
    activeResultIndex: 0,
    fieldMappings: {},
    angles: [],
    materials: [],
    variations: [],
    motionClips: [],
    referencePhotos: [],
    canonicalDescription: "",
    styleLock: false,
    anglesStatus: "idle",
    materialsStatus: "idle",
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
}
vi.mock("../use-object-studio", () => ({
  useObjectStudio: () => mockStudioState,
}))

// The modal-level jobs hook is only consumed by the Sheet page (stubbed below);
// stub it inert so the realtime subscription effect never runs in tests.
vi.mock("../use-object-studio-jobs", () => ({
  useObjectStudioJobs: () => ({
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
vi.mock("../pages/materials-page", () => ({
  MaterialsPage: () => <div data-testid="materials-page-mounted">materials-page</div>,
}))
vi.mock("../pages/variations-page", () => ({
  VariationsPage: () => <div data-testid="variations-page-mounted">variations-page</div>,
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

import { ObjectStudioModal } from "../object-studio-modal"

const defaultStagedData = () =>
  ({
    label: "Object",
    objectDbId: "",
    objectName: "Vintage Lamp",
    description: "",
    category: "other",
    style: "realistic",
    sourceImageUrl: "",
    projectId: "proj-1",
    createdAt: "",
    executionStatus: "idle",
    generatedResults: [],
    activeResultIndex: 0,
    fieldMappings: {},
    angles: [],
    materials: [],
    variations: [],
    motionClips: [],
    referencePhotos: [],
    canonicalDescription: "",
    styleLock: false,
    anglesStatus: "idle",
    materialsStatus: "idle",
    variationsStatus: "idle",
    motionStatus: "idle",
    customVariations: [],
  }) as unknown as Record<string, unknown>

describe("ObjectStudioModal", () => {
  beforeEach(() => {
    mockStudioState.stagedData = defaultStagedData()
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
    render(<ObjectStudioModal nodeId="obj-1" onClose={() => {}} />)
    expect(screen.getByRole("heading", { name: /vintage lamp/i })).toBeInTheDocument()
    expect(screen.getByTestId("appearance-page-mounted")).toBeInTheDocument()
    expect(screen.getByRole("dialog")).toHaveAttribute("aria-modal", "true")
  })

  it("renders 'Loading object…' placeholder when stagedData is null (cold-load)", () => {
    mockStudioState.stagedData = null
    render(<ObjectStudioModal nodeId="obj-1" onClose={() => {}} />)
    expect(screen.getByText(/loading object/i)).toBeInTheDocument()
    expect(screen.queryByTestId("appearance-page-mounted")).not.toBeInTheDocument()
  })

  it("Escape closes when not dirty (no confirm)", () => {
    const onClose = vi.fn()
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true)
    render(<ObjectStudioModal nodeId="obj-1" onClose={onClose} />)
    fireEvent.keyDown(window, { key: "Escape" })
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(confirmSpy).not.toHaveBeenCalled()
  })

  it("Escape prompts via window.confirm when dirty; cancel keeps modal open", () => {
    mockStudioState.isDirty = true
    const onClose = vi.fn()
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false)
    render(<ObjectStudioModal nodeId="obj-1" onClose={onClose} />)
    fireEvent.keyDown(window, { key: "Escape" })
    expect(confirmSpy).toHaveBeenCalledWith("Discard unsaved changes?")
    expect(onClose).not.toHaveBeenCalled()
  })

  it("Save button is disabled when not dirty and enabled when dirty", () => {
    mockStudioState.isDirty = false
    const { rerender } = render(<ObjectStudioModal nodeId="obj-1" onClose={() => {}} />)
    expect(screen.getByRole("button", { name: /^save$/i })).toBeDisabled()

    mockStudioState.isDirty = true
    rerender(<ObjectStudioModal nodeId="obj-1" onClose={() => {}} />)
    expect(screen.getByRole("button", { name: /^save$/i })).not.toBeDisabled()
  })

  it("Close button is disabled while saving", () => {
    mockStudioState.isSaving = true
    render(<ObjectStudioModal nodeId="obj-1" onClose={() => {}} />)
    expect(screen.getByRole("button", { name: /close/i })).toBeDisabled()
  })

  it("Style Lock toggle calls patch with the new value", () => {
    render(<ObjectStudioModal nodeId="obj-1" onClose={() => {}} />)
    const toggle = screen.getByRole("checkbox", { name: /style lock/i })
    fireEvent.click(toggle)
    expect(mockStudioState.patch).toHaveBeenCalledWith({ styleLock: true })
  })

  it("renders all 7 sidebar page buttons (References + Appearance + Angles + Materials + Variations + Motion + Sheet)", () => {
    render(<ObjectStudioModal nodeId="obj-1" onClose={() => {}} />)
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
    render(<ObjectStudioModal nodeId="obj-1" onClose={() => {}} />)
    expect(screen.queryByRole("button", { name: /time of day/i })).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /weather/i })).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /seasons/i })).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /lighting/i })).not.toBeInTheDocument()
  })

  it("renders all 6 sidebar group headers (Resources / Identity / Composition / Variants / Motion / Sheet)", () => {
    render(<ObjectStudioModal nodeId="obj-1" onClose={() => {}} />)
    // The first 4 group labels are unique strings. "Motion" and "Sheet" are
    // each shared by a group header AND a page button, so assert presence (≥1).
    for (const label of ["Resources", "Identity", "Composition", "Variants"]) {
      expect(screen.getByText(new RegExp(`^${label}$`, "i"))).toBeInTheDocument()
    }
    expect(screen.getAllByText(/^Motion$/i).length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText(/^Sheet$/i).length).toBeGreaterThanOrEqual(1)
  })

  it("promotes References to a first-class page and switches the body to it", () => {
    render(<ObjectStudioModal nodeId="obj-1" onClose={() => {}} />)
    fireEvent.click(screen.getByRole("button", { name: /references/i }))
    expect(screen.getByTestId("references-page-mounted")).toBeInTheDocument()
    expect(screen.queryByTestId("appearance-page-mounted")).not.toBeInTheDocument()
  })

  it("defaults to the Appearance page body", () => {
    render(<ObjectStudioModal nodeId="obj-1" onClose={() => {}} />)
    expect(screen.getByTestId("appearance-page-mounted")).toBeInTheDocument()
    expect(screen.queryByTestId("angles-page-mounted")).not.toBeInTheDocument()
  })

  it("clicking Angles swaps the body to the Angles page", () => {
    render(<ObjectStudioModal nodeId="obj-1" onClose={() => {}} />)
    fireEvent.click(screen.getByRole("button", { name: /angles/i }))
    expect(screen.getByTestId("angles-page-mounted")).toBeInTheDocument()
    expect(screen.queryByTestId("appearance-page-mounted")).not.toBeInTheDocument()
  })

  it("clicking Materials swaps the body to the Materials page", () => {
    render(<ObjectStudioModal nodeId="obj-1" onClose={() => {}} />)
    fireEvent.click(screen.getByRole("button", { name: /materials/i }))
    expect(screen.getByTestId("materials-page-mounted")).toBeInTheDocument()
  })

  it("clicking Variations swaps the body to the Variations page", () => {
    render(<ObjectStudioModal nodeId="obj-1" onClose={() => {}} />)
    fireEvent.click(screen.getByRole("button", { name: /variations/i }))
    expect(screen.getByTestId("variations-page-mounted")).toBeInTheDocument()
  })

  it("clicking Motion swaps the body to the Motion page", () => {
    render(<ObjectStudioModal nodeId="obj-1" onClose={() => {}} />)
    fireEvent.click(screen.getByRole("button", { name: /motion/i }))
    expect(screen.getByTestId("motion-page-mounted")).toBeInTheDocument()
  })

  it("clicking Sheet swaps the body to the Sheet page", () => {
    render(<ObjectStudioModal nodeId="obj-1" onClose={() => {}} />)
    fireEvent.click(screen.getByRole("button", { name: /sheet/i }))
    expect(screen.getByTestId("sheet-page-mounted")).toBeInTheDocument()
  })

  it("shows count badges next to pages when the corresponding bucket has assets", () => {
    const data = mockStudioState.stagedData as Record<string, unknown>
    data.angles = [
      { name: "front", url: "https://r2/a.png" },
      { name: "side", url: "https://r2/b.png" },
    ]
    data.materials = [{ name: "wood", url: "https://r2/m.png" }]
    data.variations = []
    data.motionClips = [
      { name: "rotate-360", url: "https://r2/c.mp4" },
      { name: "hover", url: "https://r2/d.mp4" },
      { name: "spin-slow", url: "https://r2/e.mp4" },
    ]

    render(<ObjectStudioModal nodeId="obj-1" onClose={() => {}} />)

    // Counts render as the shell's pill badge appended to the page label.
    expect(screen.getByRole("button", { name: /angles.*2/i })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /materials.*1/i })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /motion.*3/i })).toBeInTheDocument()
    // Zero-count pages omit the badge digit entirely.
    expect(screen.getByRole("button", { name: /variations/i }).textContent).not.toMatch(/\d/)
    // Appearance + References never show a count (not list buckets).
    expect(screen.getByRole("button", { name: /appearance/i }).textContent).not.toMatch(/\d/)
    expect(screen.getByRole("button", { name: /references/i }).textContent).not.toMatch(/\d/)
  })
})
