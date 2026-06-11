import { describe, it, expect, vi } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import { TextPromptConfig, LoopConfig } from "../input-configs"

vi.mock("@/components/ui/label", () => ({
  Label: ({ children, ...props }: any) => <label {...props}>{children}</label>,
}))

vi.mock("@/components/ui/textarea", () => ({
  Textarea: (props: any) => <textarea {...props} />,
}))

vi.mock("@/components/editor/config-panels/tag-textarea", () => ({
  TagTextarea: ({ value, onChange, placeholder, className, rows }: any) => (
    <textarea
      value={value}
      onChange={(e: any) => onChange(e.target.value)}
      placeholder={placeholder}
      className={className}
      rows={rows}
    />
  ),
}))

vi.mock("@/components/ui/input", () => ({
  Input: (props: any) => <input {...props} />,
}))

vi.mock("@/components/ui/button", () => ({
  Button: ({ children, ...props }: any) => <button {...props}>{children}</button>,
}))

vi.mock("@/components/ui/select", () => ({
  Select: ({ children }: any) => <div>{children}</div>,
  SelectContent: ({ children }: any) => <div>{children}</div>,
  SelectItem: ({ children, value }: any) => <option value={value}>{children}</option>,
  SelectTrigger: ({ children }: any) => <div>{children}</div>,
  SelectValue: () => <span />,
}))

vi.mock("@/components/ui/cached-image", () => ({
  CachedImage: (props: any) => <img src={props.src} alt={props.alt} />,
}))

vi.mock("@/lib/api", () => ({
  uploadAudio: vi.fn(),
  fetchYouTubeOEmbed: vi.fn(),
  extractYouTubeAudioApi: vi.fn(),
  getJobStatusLean: vi.fn(),
  startVideoDownload: vi.fn(),
  subscribeToDownloadProgress: vi.fn(),
}))

// Zustand store mock — LoopConfig subscribes to `edges` and `nodes` selectors.
vi.mock("@/hooks/use-workflow-store", () => ({
  useWorkflowStore: (selector: any) =>
    selector({
      edges: [],
      nodes: [],
    }),
}))

// Any of these may be imported transitively from input-configs.
vi.mock("@/components/editor/workflow-editor/node-input-resolver", () => ({
  resolveEdgeValuesForTableColumn: () => null,
}))

vi.mock("@/ee/components/credits/StorageExceededModal", () => ({
  StorageExceededModal: () => null,
}))

vi.mock("@/hooks/use-file-upload", () => ({
  useFileUpload: () => ({
    upload: vi.fn(),
    isUploading: false,
    uploadError: null,
    clearError: vi.fn(),
    storageExceeded: { exceeded: false, usedBytes: 0, quotaBytes: 0, tier: "" },
    clearStorageExceeded: vi.fn(),
  }),
}))

vi.mock("sonner", () => ({
  toast: { warning: vi.fn(), success: vi.fn(), error: vi.fn(), info: vi.fn() },
}))

vi.mock("@dnd-kit/core", () => ({
  DndContext: ({ children }: any) => <div>{children}</div>,
  closestCenter: vi.fn(),
  KeyboardSensor: vi.fn(),
  PointerSensor: vi.fn(),
  useSensor: vi.fn(),
  useSensors: vi.fn(() => []),
}))

vi.mock("@dnd-kit/sortable", () => ({
  SortableContext: ({ children }: any) => <div>{children}</div>,
  sortableKeyboardCoordinates: vi.fn(),
  verticalListSortingStrategy: vi.fn(),
  useSortable: () => ({
    attributes: {},
    listeners: {},
    setNodeRef: vi.fn(),
    transform: null,
    transition: "",
    isDragging: false,
  }),
  arrayMove: (arr: any[]) => arr,
}))

vi.mock("@dnd-kit/utilities", () => ({
  CSS: { Transform: { toString: () => "" } },
}))

vi.mock("./prompt-helper-button", () => ({
  PromptHelperButton: () => null,
}))
vi.mock("@/components/editor/config-panels/snippet-menu-button", () => ({
  SnippetMenuButton: () => null,
}))
vi.mock("@/hooks/queries/use-prompt-snippets-queries", () => ({
  useSnippetPool: () => [],
}))

vi.mock("lucide-react", () => ({
  X: () => <span data-testid="x-icon" />,
  Plus: () => <span data-testid="plus-icon" />,
  Loader2: () => <span data-testid="loader-icon" />,
  Check: () => <span data-testid="check-icon" />,
  Download: () => <span data-testid="download-icon" />,
  AlertCircle: () => <span data-testid="alert-icon" />,
  Sparkles: () => <span data-testid="sparkles-icon" />,
  Upload: () => <span data-testid="upload-icon" />,
  Film: () => <span data-testid="film-icon" />,
  Music: () => <span data-testid="music-icon" />,
  Link: () => <span data-testid="link-icon" />,
  GripVertical: () => <span data-testid="grip-icon" />,
  Scissors: () => <span data-testid="scissors-icon" />,
}))

function createDefaultProps(overrides: Record<string, unknown> = {}) {
  return {
    data: { label: "Text Prompt", text: "initial text", variables: {} },
    onUpdate: vi.fn(),
    sources: [],
    fieldMappings: {},
    onMapField: vi.fn(),
    nodes: [],
    ...overrides,
  } as any
}

describe("TextPromptConfig", () => {
  it("renders textarea with current text value", () => {
    render(<TextPromptConfig {...createDefaultProps()} />)
    const textarea = screen.getByPlaceholderText("Enter your story prompt...")
    expect(textarea).toHaveValue("initial text")
  })

  it("renders the Prompt Text label", () => {
    render(<TextPromptConfig {...createDefaultProps()} />)
    expect(screen.getByText("Prompt Text")).toBeInTheDocument()
  })

  it("calls onUpdate when textarea value changes", () => {
    const onUpdate = vi.fn()
    render(<TextPromptConfig {...createDefaultProps({ onUpdate })} />)
    const textarea = screen.getByPlaceholderText("Enter your story prompt...")
    fireEvent.change(textarea, { target: { value: "new prompt text" } })
    expect(onUpdate).toHaveBeenCalledWith({ text: "new prompt text" })
  })

  it("calls onUpdate with empty string when textarea is cleared", () => {
    const onUpdate = vi.fn()
    render(<TextPromptConfig {...createDefaultProps({ onUpdate })} />)
    const textarea = screen.getByPlaceholderText("Enter your story prompt...")
    fireEvent.change(textarea, { target: { value: "" } })
    expect(onUpdate).toHaveBeenCalledWith({ text: "" })
  })

  it("renders textarea with correct rows", () => {
    render(<TextPromptConfig {...createDefaultProps()} />)
    const textarea = screen.getByPlaceholderText("Enter your story prompt...")
    expect(textarea).toHaveAttribute("rows", "5")
  })

  it("renders with empty text data", () => {
    const props = createDefaultProps({
      data: { label: "Text Prompt", text: "", variables: {} },
    })
    render(<TextPromptConfig {...props} />)
    const textarea = screen.getByPlaceholderText("Enter your story prompt...")
    expect(textarea).toHaveValue("")
  })

  it("renders the Prompt Text label element", () => {
    render(<TextPromptConfig {...createDefaultProps()} />)
    const label = screen.getByText("Prompt Text")
    expect(label).toBeInTheDocument()
  })
})

describe("LoopConfig — Split button", () => {
  it("calls onUpdate with split rows when Split button is clicked", () => {
    const onUpdate = vi.fn()
    const columnId = "col-1"
    const data = {
      label: "List",
      columns: [
        {
          id: columnId,
          name: "Items",
          handleId: `col_${columnId}`,
          type: "text" as const,
          splitDelimiter: ",",
        },
      ],
      rows: [["apple,banana,cherry"]],
    }

    render(
      <LoopConfig
        data={data as any}
        onUpdate={onUpdate}
        nodeId="n1"
      />,
    )

    // "Split" button rendered by DelimiterSelect (only present when delimiter is truthy)
    const splitButton = screen.getByRole("button", { name: /split/i })
    fireEvent.click(splitButton)

    expect(onUpdate).toHaveBeenCalledWith({
      rows: [["apple"], ["banana"], ["cherry"]],
    })
  })
})

describe("LoopConfig — List vs Table UI derived from column count", () => {
  const col = (id: string, name: string) => ({
    id,
    name,
    handleId: `col_${id}`,
    type: "text" as const,
  })

  it("renders the single-column List UI when there is one column", () => {
    // rows:[] keeps the table free of per-row remove (X) buttons so the only X
    // icons that could appear are the per-column remove buttons under test.
    render(
      <LoopConfig
        data={{ columns: [col("c1", "Items")], rows: [], fieldMappings: {} } as any}
        onUpdate={() => {}}
        nodeId="n1"
      />,
    )

    // Label reads "List", and the "Add Column" affordance + per-column remove (X) are hidden.
    expect(screen.getByText("List")).toBeInTheDocument()
    expect(screen.queryByText("Table")).not.toBeInTheDocument()
    expect(screen.queryByText("Add Column")).not.toBeInTheDocument()
    expect(screen.queryByTestId("x-icon")).not.toBeInTheDocument()
  })

  it("offers the Add Column affordance when there are zero columns (broken/bootstrap state)", () => {
    // 0 columns is a degenerate state (e.g. an empty Table migrated to a list
    // with columns:[]). The canvas "+" quick-add handle is the only other path,
    // so the config panel MUST offer an Add Column affordance here to recover.
    render(
      <LoopConfig
        data={{ columns: [], rows: [], fieldMappings: {} } as any}
        onUpdate={() => {}}
        nodeId="n1"
      />,
    )

    expect(screen.getByText("List")).toBeInTheDocument()
    expect(screen.getByText("Add Column")).toBeInTheDocument()
  })

  it("calls onUpdate with a new column when Add Column is clicked at zero columns", () => {
    const onUpdate = vi.fn()
    render(
      <LoopConfig
        data={{ columns: [], rows: [], fieldMappings: {} } as any}
        onUpdate={onUpdate}
        nodeId="n1"
      />,
    )

    fireEvent.click(screen.getByText("Add Column"))

    expect(onUpdate).toHaveBeenCalledTimes(1)
    const patch = onUpdate.mock.calls[0][0]
    expect(patch.columns).toHaveLength(1)
    expect(patch.columns[0]).toMatchObject({ name: "Column 1", type: "text" })
    expect(patch.rows).toEqual([])
  })

  it("renders the multi-column Table UI when there are two or more columns", () => {
    // rows:[] isolates the per-column remove (X) buttons (no per-row X confound).
    render(
      <LoopConfig
        data={{
          columns: [col("c1", "Name"), col("c2", "Age")],
          rows: [],
          fieldMappings: {},
        } as any}
        onUpdate={() => {}}
        nodeId="n1"
      />,
    )

    // Label reads "Table", and the "Add Column" affordance + per-column remove (X) are visible.
    expect(screen.getByText("Table")).toBeInTheDocument()
    expect(screen.queryByText("List")).not.toBeInTheDocument()
    expect(screen.getByText("Add Column")).toBeInTheDocument()
    // One remove (X) button per column.
    expect(screen.getAllByTestId("x-icon")).toHaveLength(2)
  })
})
