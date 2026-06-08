import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"

vi.mock("lucide-react", () => {
  const Icon = (props: any) => <span data-testid="mock-icon" {...props} />
  return {
    Play: Icon,
    Loader2: Icon,
    Upload: Icon,
    UserCircle: Icon,
    ChevronDown: Icon,
    Check: Icon,
    ChevronDownIcon: Icon,
    ChevronUpIcon: Icon,
    CheckIcon: Icon,
  }
})

const setObjectStudioNodeIdMock = vi.fn()
vi.mock("@/hooks/use-workflow-store", () => ({
  useWorkflowStore: (selector: any) => selector({
    setObjectStudioNodeId: setObjectStudioNodeIdMock,
    setCharacterStudioNodeId: vi.fn(),
    setLocationStudioNodeId: vi.fn(),
    selectedNodeId: "obj-node-1",
    nodes: [],
    edges: [],
    projectId: null,
  }),
}))

vi.mock("@/components/editor/media-editor", () => ({
  useMediaEditor: () => ({ openEditor: vi.fn() }),
  MediaEditorModal: () => null,
}))

vi.mock("@/components/ui/cached-image", () => ({
  CachedImage: (props: any) => <img alt={props.alt} src={props.src} />,
}))

vi.mock("@/hooks/queries/use-assets-queries", () => ({
  useCharacters: () => ({ data: [], isLoading: false }),
}))

vi.mock("@/hooks/use-auth", () => ({
  useAuth: () => ({ user: null }),
}))

vi.mock("@/ee/hooks/use-model-credits", () => ({
  prefetchModelCredits: vi.fn(),
  useModelCredits: () => 1,
}))

vi.mock("./model-options", () => ({
  IMAGE_GEN_MODELS: [],
  IMAGE_GEN_MODEL_IDS: [],
}))

vi.mock("./model-select-option", () => ({
  ModelSelectOption: () => null,
}))

vi.mock("./model-description-hint", () => ({
  ModelDescriptionHint: () => null,
}))

vi.mock("./mappable-field", () => ({
  MappableField: ({ children }: any) => <div data-testid="mappable-field">{children}</div>,
}))

vi.mock("./entity-shared", () => ({
  LocationAssetButton: () => null,
  LocationAssetGrid: () => null,
}))

import { ObjectConfig } from "../entity-configs"

function renderObjectConfig(overrides: Record<string, unknown> = {}) {
  const defaultProps = {
    data: {
      label: "Object",
      style: "realistic",
      category: "weapon",
      objectName: "Sword",
      description: "",
      provider: "nano-banana",
      sourceImageUrl: "",
      executionStatus: "idle",
      activeResultIndex: 0,
      generatedResults: [],
      fieldMappings: {},
      angles: [],
      materials: [],
      variations: [],
      anglesStatus: "idle",
      materialsStatus: "idle",
      variationsStatus: "idle",
      customVariations: [],
      motionClips: [],
      motionStatus: "idle",
      referencePhotos: [],
      canonicalDescription: "",
      styleLock: true,
    },
    onUpdate: vi.fn(),
    sources: [],
    fieldMappings: {},
    onMapField: vi.fn(),
    nodeId: "obj-node-1",
    ...overrides,
  } as any
  return render(<ObjectConfig {...defaultProps} />)
}

describe("ObjectConfig (Phase E3/2 — Studio stub)", () => {
  beforeEach(() => {
    setObjectStudioNodeIdMock.mockClear()
  })

  it("renders the Open Object/Props Studio button", () => {
    renderObjectConfig()
    const btn = screen.getByRole("button", { name: "Open Object/Props Studio" })
    expect(btn).toBeInTheDocument()
  })

  it("clicking the Studio button calls setObjectStudioNodeId with the nodeId", () => {
    renderObjectConfig()
    const btn = screen.getByRole("button", { name: "Open Object/Props Studio" })
    fireEvent.click(btn)
    expect(setObjectStudioNodeIdMock).toHaveBeenCalledWith("obj-node-1")
  })

  it("disables the Studio button when nodeId is undefined (no-op)", () => {
    renderObjectConfig({ nodeId: undefined })
    const btn = screen.getByRole("button", { name: "Open Object/Props Studio" })
    expect(btn).toBeDisabled()
    fireEvent.click(btn)
    expect(setObjectStudioNodeIdMock).not.toHaveBeenCalled()
  })

  it("shows the object name in the summary", () => {
    renderObjectConfig({ data: { objectName: "Excalibur", style: "realistic", category: "weapon", description: "", provider: "nano-banana", sourceImageUrl: "", executionStatus: "idle", activeResultIndex: 0, generatedResults: [], fieldMappings: {}, angles: [], materials: [], variations: [], anglesStatus: "idle", materialsStatus: "idle", variationsStatus: "idle", customVariations: [], motionClips: [], motionStatus: "idle", referencePhotos: [], canonicalDescription: "", styleLock: true } })
    expect(screen.getByText("Excalibur")).toBeInTheDocument()
  })

  it("shows '(unnamed object)' when no objectName", () => {
    renderObjectConfig({ data: { objectName: "", style: "realistic", category: "weapon", description: "", provider: "nano-banana", sourceImageUrl: "", executionStatus: "idle", activeResultIndex: 0, generatedResults: [], fieldMappings: {}, angles: [], materials: [], variations: [], anglesStatus: "idle", materialsStatus: "idle", variationsStatus: "idle", customVariations: [], motionClips: [], motionStatus: "idle", referencePhotos: [], canonicalDescription: "", styleLock: true } })
    expect(screen.getByText("(unnamed object)")).toBeInTheDocument()
  })

  it("renders the style lock checkbox + label", () => {
    renderObjectConfig()
    expect(screen.getByLabelText("Style Lock")).toBeInTheDocument()
  })

  it("calls onUpdate when toggling style lock", () => {
    const onUpdate = vi.fn()
    renderObjectConfig({ onUpdate })
    const checkbox = screen.getByLabelText("Style Lock") as HTMLInputElement
    fireEvent.click(checkbox)
    expect(onUpdate).toHaveBeenCalledWith({ styleLock: false })
  })
})
