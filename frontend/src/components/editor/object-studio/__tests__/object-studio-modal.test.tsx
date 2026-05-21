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

// Stub the 5 tab modules so the test doesn't depend on their internals.
vi.mock("../appearance-tab", () => ({
  AppearanceTab: () => <div data-testid="appearance-tab-mounted">appearance-tab</div>,
}))
vi.mock("../angles-tab", () => ({
  AnglesTab: () => <div data-testid="angles-tab-mounted">angles-tab</div>,
}))
vi.mock("../materials-tab", () => ({
  MaterialsTab: () => <div data-testid="materials-tab-mounted">materials-tab</div>,
}))
vi.mock("../variations-tab", () => ({
  VariationsTab: () => <div data-testid="variations-tab-mounted">variations-tab</div>,
}))
vi.mock("../motion-tab", () => ({
  MotionTab: () => <div data-testid="motion-tab-mounted">motion-tab</div>,
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

  it("renders the header title from stagedData and mounts the Appearance tab", () => {
    render(<ObjectStudioModal nodeId="obj-1" onClose={() => {}} />)
    expect(screen.getByRole("heading", { name: /vintage lamp/i })).toBeInTheDocument()
    expect(screen.getByTestId("appearance-tab-mounted")).toBeInTheDocument()
    expect(screen.getByRole("dialog")).toHaveAttribute("aria-modal", "true")
  })

  it("renders 'Loading object…' placeholder when stagedData is null (cold-load)", () => {
    mockStudioState.stagedData = null
    render(<ObjectStudioModal nodeId="obj-1" onClose={() => {}} />)
    expect(screen.getByText(/loading object/i)).toBeInTheDocument()
    expect(screen.queryByTestId("appearance-tab-mounted")).not.toBeInTheDocument()
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

  it("renders all 5 sidebar tab buttons (Appearance, Angles, Materials, Variations, Motion)", () => {
    render(<ObjectStudioModal nodeId="obj-1" onClose={() => {}} />)
    expect(screen.getByRole("button", { name: /appearance/i })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /angles/i })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /materials/i })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /variations/i })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /motion/i })).toBeInTheDocument()
  })

  it("does NOT render location-only tabs (Time of Day / Weather / Seasons / Lighting)", () => {
    render(<ObjectStudioModal nodeId="obj-1" onClose={() => {}} />)
    expect(screen.queryByRole("button", { name: /time of day/i })).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /weather/i })).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /seasons/i })).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /lighting/i })).not.toBeInTheDocument()
  })

  it("renders 4 sidebar section headers (Identity / Composition / Variants / Motion)", () => {
    render(<ObjectStudioModal nodeId="obj-1" onClose={() => {}} />)
    expect(screen.getByText(/^identity$/i)).toBeInTheDocument()
    expect(screen.getByText(/^composition$/i)).toBeInTheDocument()
    expect(screen.getByText(/^variants$/i)).toBeInTheDocument()
    // "Motion" appears both as a section header and a tab button — assert at
    // least one match.
    expect(screen.getAllByText(/^motion$/i).length).toBeGreaterThanOrEqual(1)
  })

  it("defaults to the Appearance tab body", () => {
    render(<ObjectStudioModal nodeId="obj-1" onClose={() => {}} />)
    expect(screen.getByTestId("appearance-tab-mounted")).toBeInTheDocument()
    expect(screen.queryByTestId("angles-tab-mounted")).not.toBeInTheDocument()
  })

  it("clicking Angles swaps the body to the Angles tab", () => {
    render(<ObjectStudioModal nodeId="obj-1" onClose={() => {}} />)
    fireEvent.click(screen.getByRole("button", { name: /angles/i }))
    expect(screen.getByTestId("angles-tab-mounted")).toBeInTheDocument()
    expect(screen.queryByTestId("appearance-tab-mounted")).not.toBeInTheDocument()
  })

  it("clicking Materials swaps the body to the Materials tab", () => {
    render(<ObjectStudioModal nodeId="obj-1" onClose={() => {}} />)
    fireEvent.click(screen.getByRole("button", { name: /materials/i }))
    expect(screen.getByTestId("materials-tab-mounted")).toBeInTheDocument()
  })

  it("clicking Variations swaps the body to the Variations tab", () => {
    render(<ObjectStudioModal nodeId="obj-1" onClose={() => {}} />)
    fireEvent.click(screen.getByRole("button", { name: /variations/i }))
    expect(screen.getByTestId("variations-tab-mounted")).toBeInTheDocument()
  })

  it("clicking Motion swaps the body to the Motion tab", () => {
    render(<ObjectStudioModal nodeId="obj-1" onClose={() => {}} />)
    fireEvent.click(screen.getByRole("button", { name: /motion/i }))
    expect(screen.getByTestId("motion-tab-mounted")).toBeInTheDocument()
  })

  it("shows count badges next to tabs when the corresponding bucket has assets", () => {
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

    expect(screen.getByRole("button", { name: /angles.*\(2\)/i })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /materials.*\(1\)/i })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /motion.*\(3\)/i })).toBeInTheDocument()
    // Zero-count tabs omit the parenthetical entirely.
    expect(screen.getByRole("button", { name: /variations/i }).textContent).not.toMatch(/\(/)
    // Appearance never shows a count.
    expect(screen.getByRole("button", { name: /appearance/i }).textContent).not.toMatch(/\(/)
  })
})
