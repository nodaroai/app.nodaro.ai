import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, cleanup } from "@testing-library/react"
import { ReduceNode } from "../reduce-node"

vi.mock("@xyflow/react", () => ({
  Position: { Top: "top", Bottom: "bottom", Left: "left", Right: "right" },
  Handle: ({ type, position, id }: any) => (
    <div data-testid={`handle-${type}-${id}`} data-type={type} data-position={position} />
  ),
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
  BaseNode: ({ children, label, category, credits, id, isRunning, handles }: any) => (
    <div
      data-testid="base-node"
      data-label={label}
      data-category={category}
      data-credits={credits}
      data-id={id}
      data-is-running={isRunning}
      data-handles={JSON.stringify(handles?.map((h: any) => ({ id: h.id, type: h.type })) ?? [])}
    >
      {children}
    </div>
  ),
}))

vi.mock("lucide-react", () => {
  const I = (p: any) => <span data-testid="mock-icon" {...p} />
  return { Funnel: I, Trophy: I, Braces: I, FileText: I }
})

vi.mock("@/components/ui/cached-image", () => ({
  CachedImage: ({ src }: { src: string }) => <img data-testid="cached-image" src={src} alt="" />,
}))

// The MODE / AI Model chips are shadcn Selects — flatten to native <select>s
// (same contract the reduce-configs test uses) so we can read + change them.
vi.mock("@/components/ui/select", () => {
  const React = require("react")
  return {
    Select: ({ children, value, onValueChange }: any) => {
      const items: any[] = []
      React.Children.forEach(children, (child: any) => {
        if (child?.type?.displayName === "SelectContent") {
          React.Children.forEach(child.props?.children, (item: any) => { if (item) items.push(item) })
        }
      })
      return (
        <select role="combobox" value={value ?? ""} onChange={(e: any) => onValueChange?.(e.target.value)}>
          {items}
        </select>
      )
    },
    SelectContent: Object.assign(({ children }: any) => <>{children}</>, { displayName: "SelectContent" }),
    SelectItem: ({ children, value }: any) => <option value={value}>{typeof children === "string" ? children : value}</option>,
    SelectTrigger: Object.assign(({ children }: any) => <>{children}</>, { displayName: "SelectTrigger" }),
    SelectValue: () => null,
  }
})

vi.mock("../run-node-button", () => ({
  RunNodeButton: () => <div data-testid="run-node-button" />,
}))

const updateNodeDataMock = vi.fn()

vi.mock("@/hooks/use-workflow-store", () => ({
  EXECUTION_DATA_KEYS: new Set(["executionStatus"]),
  useWorkflowStore: Object.assign(
    (selector: any) =>
      selector({
        runFromHere: () => {},
        updateNodeData: updateNodeDataMock,
        loadGeneration: 0,
      }),
    { getState: () => ({ nodes: [], edges: [] }) },
  ),
}))

vi.mock("../editable-node-label", () => ({
  EditableNodeLabel: ({ label }: any) => (
    <div data-testid="editable-label">{label ?? "(no label)"}</div>
  ),
}))

vi.mock("../handle-icon", () => ({
  HandleIcon: ({ icon }: any) => <div data-testid="handle-icon">{icon}</div>,
}))

function renderNode(overrides: Record<string, unknown> = {}) {
  const defaultProps = {
    id: "C1",
    data: {
      label: "Choose Best",
      strategyId: "concat",
      strategyConfig: {},
    },
    selected: false,
    ...overrides,
  } as any
  return render(<ReduceNode {...defaultProps} />)
}

/** The <select> whose options include `optionValue` (there are 1-2 chips). */
function selectWithOption(optionValue: string): HTMLSelectElement | undefined {
  return screen
    .getAllByRole("combobox")
    .find((el) => Array.from(el.querySelectorAll("option")).some((o) => o.value === optionValue)) as HTMLSelectElement | undefined
}

describe("ReduceNode", () => {
  beforeEach(() => updateNodeDataMock.mockClear())

  it("renders without crashing", () => {
    renderNode()
    expect(screen.getByTestId("base-node")).toBeInTheDocument()
  })

  it("passes processing category", () => {
    renderNode()
    expect(screen.getByTestId("base-node")).toHaveAttribute("data-category", "processing")
  })

  it("passes zero credits (strategy cost surfaced in config panel, not header)", () => {
    renderNode()
    expect(screen.getByTestId("base-node")).toHaveAttribute("data-credits", "0")
  })

  // ── Head row: MODE chip + AI Model chip ────────────────────────────────
  it("renders the MODE chip with every strategy and writes strategyId + snapped defaults on change", () => {
    renderNode()
    const mode = selectWithOption("pick-best-llm")
    expect(mode).toBeDefined()
    expect(mode!.value).toBe("concat")
    fireEvent.change(mode!, { target: { value: "vote" } })
    expect(updateNodeDataMock).toHaveBeenCalledWith("C1", expect.objectContaining({
      strategyId: "vote",
      strategyConfig: expect.objectContaining({ caseSensitive: false }),
    }))
  })

  it("renders the AI Model chip ONLY in AI mode and writes strategyConfig.llmModel", () => {
    renderNode({ data: { label: "Choose Best", strategyId: "concat", strategyConfig: {} } })
    expect(selectWithOption("claude-opus-4.8")).toBeUndefined()

    cleanup()
    renderNode({ data: { label: "Choose Best", strategyId: "pick-best-llm", strategyConfig: { criteria: "best", inputKind: "text" } } })
    const model = selectWithOption("claude-opus-4.8")
    expect(model).toBeDefined()
    fireEvent.change(model!, { target: { value: "claude-opus-4.8" } })
    expect(updateNodeDataMock).toHaveBeenCalledWith("C1", {
      strategyConfig: { criteria: "best", inputKind: "text", llmModel: "claude-opus-4.8" },
    })
  })

  it("renders the Texts/Images chip ONLY in AI mode and writes strategyConfig.inputKind", () => {
    // Regression: the kind lived only in the side panel — a node fed two
    // images stayed on the default Texts and the AI compared their links.
    renderNode({ data: { label: "Choose Best", strategyId: "concat", strategyConfig: {} } })
    expect(selectWithOption("image-url")).toBeUndefined()

    cleanup()
    renderNode({ data: { label: "Choose Best", strategyId: "pick-best-llm", strategyConfig: { criteria: "best", inputKind: "text" } } })
    const kind = selectWithOption("image-url")
    expect(kind).toBeDefined()
    expect(kind!.value).toBe("text")
    fireEvent.change(kind!, { target: { value: "image-url" } })
    expect(updateNodeDataMock).toHaveBeenCalledWith("C1", {
      strategyConfig: { criteria: "best", inputKind: "image-url" },
    })
  })

  it("shows the arrived count (the kind is the chip in AI mode, part of the count otherwise)", () => {
    renderNode({
      data: { label: "Choose Best", strategyId: "pick-best-llm", strategyConfig: { inputKind: "image-url" }, __upstreamCount: 5 },
    })
    expect(screen.getByText("5 arrived")).toBeInTheDocument()

    cleanup()
    renderNode({
      data: { label: "Choose Best", strategyId: "concat", strategyConfig: { inputKind: "image-url" }, __upstreamCount: 5 },
    })
    expect(screen.getByText("5 arrived · Images")).toBeInTheDocument()
  })

  it("shows no count when nothing has arrived", () => {
    renderNode()
    expect(screen.queryByText(/arrived/)).toBeNull()
  })

  // ── Headline setting: EDITABLE in place, writes the same strategyConfig
  // key the side panel does (node ↔ panel lockstep by construction) ────────
  it("Judge by (AI judge) is a live textarea on the card that writes strategyConfig.criteria", () => {
    renderNode({
      data: { label: "Choose Best", strategyId: "pick-best-llm", strategyConfig: { criteria: "The most eye-catching cover", inputKind: "text" } },
    })
    expect(screen.getByText("Judge by")).toBeInTheDocument()
    const field = screen.getByLabelText("Judge by") as HTMLTextAreaElement
    expect(field.tagName).toBe("TEXTAREA")
    expect(field.value).toBe("The most eye-catching cover")
    fireEvent.change(field, { target: { value: "readable as a thumbnail" } })
    expect(updateNodeDataMock).toHaveBeenCalledWith("C1", {
      strategyConfig: { criteria: "readable as a thumbnail", inputKind: "text" },
    })
  })

  it("Separator (Join into one text) is a live input that writes strategyConfig.separator", () => {
    renderNode({ data: { label: "Choose Best", strategyId: "concat", strategyConfig: { separator: " • " } } })
    const field = screen.getByLabelText("Separator") as HTMLInputElement
    expect(field.tagName).toBe("INPUT")
    expect(field.value).toBe(" • ")
    fireEvent.change(field, { target: { value: " | " } })
    expect(updateNodeDataMock).toHaveBeenCalledWith("C1", { strategyConfig: { separator: " | " } })
  })

  it("Case sensitivity (Most common answer) is a live toggle that flips strategyConfig.caseSensitive", () => {
    renderNode({ data: { label: "Choose Best", strategyId: "vote", strategyConfig: { caseSensitive: false } } })
    const toggle = screen.getByRole("switch", { name: "Case sensitivity" })
    expect(toggle).toHaveAttribute("aria-checked", "false")
    expect(screen.getByText("Different letter case counts as the same answer")).toBeInTheDocument()
    fireEvent.click(toggle)
    expect(updateNodeDataMock).toHaveBeenCalledWith("C1", { strategyConfig: { caseSensitive: true } })
  })

  it("How to merge (Merge JSON objects) is a live select that writes strategyConfig.strategy", () => {
    renderNode({ data: { label: "Choose Best", strategyId: "merge-json", strategyConfig: { strategy: "deep" } } })
    const sel = selectWithOption("shallow")
    expect(sel).toBeDefined()
    expect(sel!.value).toBe("deep")
    fireEvent.change(sel!, { target: { value: "shallow" } })
    expect(updateNodeDataMock).toHaveBeenCalledWith("C1", { strategyConfig: { strategy: "shallow" } })
  })

  it("has no headline setting for modes with nothing to configure", () => {
    renderNode({ data: { label: "Choose Best", strategyId: "count", strategyConfig: {} } })
    expect(screen.queryByText("Judge by")).toBeNull()
    expect(screen.queryByText("Separator")).toBeNull()
    expect(screen.queryByRole("switch")).toBeNull()
  })

  it("falls back to 'Choose Best' when the strategyId is unknown", () => {
    renderNode({ data: { label: "X", strategyId: "nonexistent-strategy", strategyConfig: {} } })
    expect(screen.getByTestId("base-node").textContent ?? "").toContain("Choose Best")
  })

  // ── Candidates grid + OUTPUT bar ───────────────────────────────────────
  // Everything renders ON the node — no separate Preview needed. Candidates
  // come from lastInputs (persisted on completion); the winner is tagged.
  it("renders every candidate as a card and tags the WINNER; the output bar shows the winning image + reasoning", () => {
    renderNode({
      data: {
        label: "Choose Best",
        strategyId: "pick-best-llm",
        strategyConfig: { inputKind: "image-url" },
        executionStatus: "completed",
        result: "https://cdn/x/winner.png",
        lastInputs: ["https://cdn/x/a.png", "https://cdn/x/winner.png", "https://cdn/x/c.png"],
        lastMeta: { summary: "picked 2", selectedIndex: 1, reasoning: "Strongest focal point." },
      },
    })
    // 3 candidate thumbnails + 1 output thumbnail
    const imgs = screen.getAllByTestId("cached-image").map((i) => i.getAttribute("src"))
    expect(imgs).toEqual(["https://cdn/x/a.png", "https://cdn/x/winner.png", "https://cdn/x/c.png", "https://cdn/x/winner.png"])
    expect(screen.getAllByText("WINNER")).toHaveLength(1)
    expect(document.querySelectorAll("[data-winner]")).toHaveLength(1)
    expect(screen.getByText("Chose #2 of 3")).toBeInTheDocument()
    expect(screen.getByText("Strongest focal point.")).toBeInTheDocument()
    // AI mode: the kind is the head-row chip, the count stands alone.
    expect(screen.getByText("3 arrived")).toBeInTheDocument()
    expect(selectWithOption("image-url")!.value).toBe("image-url")
  })

  it("renders text candidates and a text output; no WINNER tag without a selectedIndex", () => {
    renderNode({
      data: {
        label: "Choose Best",
        strategyId: "concat",
        strategyConfig: {},
        executionStatus: "completed",
        result: "alpha, beta",
        lastInputs: ["alpha", "beta"],
        lastMeta: { summary: "joined 2" },
      },
    })
    expect(screen.queryByTestId("cached-image")).not.toBeInTheDocument()
    expect(screen.getByText("alpha")).toBeInTheDocument()
    expect(screen.getByText("beta")).toBeInTheDocument()
    expect(screen.getByText(/alpha, beta/)).toBeInTheDocument()
    expect(screen.queryByText("WINNER")).toBeNull()
    expect(screen.queryByText(/Chose #/)).toBeNull()
  })

  it("shows the empty candidates state and 'Run to see the result' before a run", () => {
    renderNode()
    expect(screen.getByText("connect candidates")).toBeInTheDocument()
    expect(screen.getByText("Run to see the result")).toBeInTheDocument()
  })

  it("declares target input and source output handles via BaseNode (unchanged)", () => {
    renderNode()
    const handles = JSON.parse(screen.getByTestId("base-node").getAttribute("data-handles") ?? "[]")
    expect(handles).toEqual(
      expect.arrayContaining([
        { id: "in", type: "target" },
        { id: "out", type: "source" },
      ]),
    )
  })
})
