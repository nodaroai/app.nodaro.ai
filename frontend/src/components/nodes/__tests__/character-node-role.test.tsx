// Character node — hybrid role dropdown + identity-lock control (gated on
// IMAGE_REFERENCE_FORMAT). Hybrid: full pill-parity role vocabulary
// (person/face/clothes/hair/pose/expression/style + Custom…) writing
// `defaultRole`, plus an off/soft/strict identity-lock sub-row writing
// `identityLock`. Legacy: the EXISTING usage-mode dropdown, no lock row.
import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import { createContext, useContext } from "react"

// Mutable holder so one file tests BOTH formats (same pattern as
// character-ref-view.test.tsx).
const fmt = { value: "hybrid" as "hybrid" | "legacy" }
vi.mock("@/lib/image-reference-format", () => ({
  get IMAGE_REFERENCE_FORMAT() {
    return fmt.value
  },
}))

vi.mock("@xyflow/react", () => ({
  Position: { Top: "top", Bottom: "bottom", Left: "left", Right: "right" },
  Handle: ({ type, id }: any) => <div data-testid={`handle-${type}-${id}`} />,
  NodeResizer: () => null,
  useStore: vi.fn(() => 1),
  useNodeId: vi.fn(() => "test-node"),
  useUpdateNodeInternals: vi.fn(() => () => {}),
  useConnection: vi.fn(() => ({ inProgress: false, fromHandle: null, fromNode: null })),
}))

vi.mock("@/components/ui/popover", () => ({
  Popover: ({ children }: any) => <>{children}</>,
  PopoverAnchor: ({ children }: any) => <>{children}</>,
  PopoverContent: () => null,
  PopoverTrigger: ({ children }: any) => <>{children}</>,
}))

vi.mock("@/hooks/use-handle-connections", () => ({
  useHandleConnections: () => [],
}))

vi.mock("../base-node", () => ({
  BaseNode: ({ children }: any) => <div data-testid="base-node">{children}</div>,
}))

vi.mock("lucide-react", async (importOriginal) => {
  const actual = await importOriginal<Record<string, any>>()
  const Icon = (props: any) => <span data-testid="mock-icon" {...props} />
  const out: Record<string, any> = {}
  for (const k of Object.keys(actual)) out[k] = Icon
  return out
})

vi.mock("../run-node-button", () => ({
  RunNodeButton: () => <div data-testid="run-node-button" />,
}))

vi.mock("@/components/ui/cached-image", () => ({
  CachedImage: (props: any) => <img data-testid="cached-image" src={props.src} alt={props.alt} />,
}))

vi.mock("@/components/editor/asset-picker/asset-picker-node-button", () => ({
  AssetPickerNodeButton: () => null,
}))

// Interactive lightweight Select mock: SelectContent always renders inline;
// SelectItem is a button that fires the owning Select's onValueChange. The
// wrapper div exposes the controlled value via data-select-value so display
// (read-through) assertions don't depend on Radix's SelectValue rendering.
const SelectCtx = createContext<(v: string) => void>(() => {})
vi.mock("@/components/ui/select", () => ({
  Select: ({ value, onValueChange, children }: any) => (
    <SelectCtx.Provider value={onValueChange}>
      <div data-testid="select" data-select-value={value}>{children}</div>
    </SelectCtx.Provider>
  ),
  SelectTrigger: ({ children, ...rest }: any) => (
    <button type="button" {...rest}>{children}</button>
  ),
  SelectValue: () => null,
  SelectContent: ({ children }: any) => <div>{children}</div>,
  SelectItem: ({ value, children }: any) => {
    const onPick = useContext(SelectCtx)
    return (
      <button type="button" data-item={value} onClick={() => onPick(value)}>
        {children}
      </button>
    )
  },
}))

const updateNodeDataMock = vi.fn()
vi.mock("@/hooks/use-workflow-store", () => ({
  useWorkflowStore: (selector: any) =>
    selector({
      updateNodeData: updateNodeDataMock,
      runSingleNode: () => {},
      setCharacterStudioNodeId: () => {},
      nodes: [],
      edges: [],
    }),
}))

vi.mock("@/ee/hooks/use-model-credits", () => ({
  useModelCredits: () => 1,
}))

import { CharacterNode } from "../character-node"

function renderCharacterNode(dataOverrides: Record<string, unknown> = {}) {
  const props = {
    id: "node-1",
    data: {
      label: "Character",
      style: "realistic",
      gender: "male",
      characterName: "Hero",
      ...dataOverrides,
    },
    selected: false,
  } as any
  return render(<CharacterNode {...props} />)
}

beforeEach(() => {
  updateNodeDataMock.mockClear()
  fmt.value = "hybrid"
})

describe("hybrid: role dropdown (full pill parity)", () => {
  it("offers the role vocabulary + Custom…, not the legacy usage-mode labels", () => {
    renderCharacterNode()
    for (const role of ["person", "face", "clothes", "hair", "pose", "expression", "style"]) {
      expect(screen.getByText(role)).toBeInTheDocument()
    }
    expect(screen.getByText("Custom…")).toBeInTheDocument()
    expect(screen.queryByText("Identical")).toBeNull()
    expect(screen.queryByText("Face only")).toBeNull()
  })

  it("picking a preset role writes defaultRole", () => {
    renderCharacterNode()
    fireEvent.click(screen.getByText("clothes"))
    expect(updateNodeDataMock).toHaveBeenCalledWith("node-1", { defaultRole: "clothes" })
  })

  it("displays the read-through effective role for a legacy node (defaultUsageMode 'face', no defaultRole)", () => {
    renderCharacterNode({ defaultUsageMode: "face" })
    expect(document.querySelector('[data-select-value="face"]')).not.toBeNull()
  })

  it("Custom… opens an input; Enter commits the sanitized slug to defaultRole", () => {
    renderCharacterNode()
    fireEvent.click(screen.getByText("Custom…"))
    // Regex: testing-library's default normalizer collapses the placeholder's
    // double spaces, so an exact-string query can never match.
    const input = screen.getByPlaceholderText(/earrings/)
    fireEvent.change(input, { target: { value: "Gold Ring" } })
    fireEvent.keyDown(input, { key: "Enter" })
    expect(updateNodeDataMock).toHaveBeenCalledWith("node-1", { defaultRole: "gold-ring" })
  })

  it("Custom… input commits on click-away (blur) — typed text is not silently discarded", () => {
    renderCharacterNode()
    fireEvent.click(screen.getByText("Custom…"))
    const input = screen.getByPlaceholderText(/earrings/)
    fireEvent.change(input, { target: { value: "freckles" } })
    fireEvent.blur(input)
    expect(updateNodeDataMock).toHaveBeenCalledWith("node-1", { defaultRole: "freckles" })
  })

  it("Escape cancels the Custom… input without writing", () => {
    renderCharacterNode()
    fireEvent.click(screen.getByText("Custom…"))
    const input = screen.getByPlaceholderText(/earrings/)
    fireEvent.change(input, { target: { value: "freckles" } })
    fireEvent.keyDown(input, { key: "Escape" })
    expect(updateNodeDataMock).not.toHaveBeenCalled()
  })

  it("a custom stored defaultRole is offered as a selectable item (display parity)", () => {
    renderCharacterNode({ defaultRole: "earrings" })
    expect(document.querySelector('[data-select-value="earrings"]')).not.toBeNull()
    expect(screen.getByText("earrings")).toBeInTheDocument()
  })
})

describe("hybrid: identity-lock sub-row", () => {
  it("renders with the runtime default 'soft' and off/soft/strict options", () => {
    renderCharacterNode()
    expect(screen.getByText("Identity lock")).toBeInTheDocument()
    expect(document.querySelector('[data-select-value="soft"]')).not.toBeNull()
    for (const label of ["Off", "Soft", "Strict"]) {
      expect(screen.getByText(label)).toBeInTheDocument()
    }
  })

  it("picking Strict writes identityLock", () => {
    renderCharacterNode()
    fireEvent.click(screen.getByText("Strict"))
    expect(updateNodeDataMock).toHaveBeenCalledWith("node-1", { identityLock: "strict" })
  })
})

describe("legacy: unchanged usage-mode dropdown, no lock row", () => {
  it("shows the legacy labels and no role/lock UI", () => {
    fmt.value = "legacy"
    renderCharacterNode()
    expect(screen.getByText("Identical")).toBeInTheDocument()
    expect(screen.getByText("Face only")).toBeInTheDocument()
    expect(screen.queryByText("Custom…")).toBeNull()
    expect(screen.queryByText("Identity lock")).toBeNull()
    expect(screen.queryByText("clothes")).toBeNull()
  })

  it("legacy picking still writes defaultUsageMode", () => {
    fmt.value = "legacy"
    renderCharacterNode()
    fireEvent.click(screen.getByText("Face only"))
    expect(updateNodeDataMock).toHaveBeenCalledWith("node-1", { defaultUsageMode: "face" })
  })
})
