// UGC Script's card in a template that ships an example run: the example's spoken lines show until
// the node's own first script, which always wins.
import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, render, screen } from "@testing-library/react"

const { store } = vi.hoisted(() => ({ store: { nodes: [] as unknown[], edges: [] as unknown[], updateNodeData: vi.fn(), isReadOnly: false } }))

vi.mock("@xyflow/react", () => ({ Position: { Top: "top", Bottom: "bottom", Left: "left", Right: "right" }, Handle: () => null }))
vi.mock("../base-node", () => ({ BaseNode: ({ children }: { children: React.ReactNode }) => <div data-testid="base-node">{children}</div> }))
vi.mock("../handle-with-popover", () => ({ HandleWithPopover: () => null, HANDLE_COLORS: { look: "#000", text: "#000" } }))
vi.mock("../node-quick-strip", () => ({ NodeQuickStrip: () => null }))
vi.mock("../editable-node-label", () => ({ EditableNodeLabel: () => null }))
vi.mock("../node-job-progress", () => ({ NodeJobProgress: () => null }))
vi.mock("../ugc-node-pips", () => ({ UgcInputPips: () => null, ugcNodeHandles: () => [], ugcPipTop: () => 0 }))
vi.mock("lucide-react", () => new Proxy({}, { get: (_t, prop) => (typeof prop === "string" && prop !== "then" ? () => null : undefined), has: () => true }))
vi.mock("@/hooks/use-workflow-store", () => ({ useWorkflowStore: (selector: (s: typeof store) => unknown) => selector(store) }))
vi.mock("@/hooks/use-model-credit-cost", () => ({ useModelCredits: () => 22 }))

import { UgcScriptNode } from "../ugc-script-node"

function renderNode(data: Record<string, unknown>) {
  return render(<UgcScriptNode {...({ id: "s", data: { label: "UGC Script", targetDurationSec: 15, keepResult: false, ...data }, selected: false } as any)} />)
}

afterEach(() => cleanup())

describe("UGC Script's example lines", () => {
  it("shows a template's example lines while the node has no script of its own", () => {
    renderNode({ exampleLines: ["Example hook.", "Example beat.", "Example closer."] })
    expect(screen.getByText("Example hook.")).toBeTruthy()
    expect(screen.getByText("Example closer.")).toBeTruthy()
  })

  it("the node's own script wins over the example", () => {
    renderNode({ exampleLines: ["Example hook."], result: { plan: { hook: "Own hook.", beats: [{ line: "Own beat." }], closer: { line: "Own closer." } } } })
    expect(screen.getByText("Own hook.")).toBeTruthy()
    expect(screen.queryByText("Example hook.")).toBeNull()
  })

  it("reads only strings from the example", () => {
    renderNode({ exampleLines: ["Kept.", 42, { line: "no" }, "  "] })
    expect(screen.getByText("Kept.")).toBeTruthy()
    expect(screen.getAllByRole("listitem")).toHaveLength(1)
  })
})
