/**
 * A selector or a Split Text that had run showed only "1 picked · 5 rest" —
 * on a template canvas it read as an empty box (2026-09-24). Both nodes now
 * show the text they hand on: the first item, clamped to a few lines.
 */
import { describe, it, expect, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import type { NodeProps } from "@xyflow/react"
import { SelectorNode } from "../selector-node"
import { SplitTextNode } from "../split-text-node"
import { textItems } from "../text-items-preview"

vi.mock("@xyflow/react", () => ({
  Position: { Top: "top", Bottom: "bottom", Left: "left", Right: "right" },
  Handle: () => null,
  useStore: vi.fn(() => 1),
  useNodeId: vi.fn(() => "test-node"),
  useUpdateNodeInternals: vi.fn(() => () => {}),
  useConnection: vi.fn(() => ({ inProgress: false, fromHandle: null, fromNode: null })),
}))

vi.mock("../base-node", () => ({
  BaseNode: ({ children }: { children?: import("react").ReactNode }) => <div data-testid="base-node">{children}</div>,
}))

vi.mock("../handle-with-popover", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  HandleWithPopover: () => null,
}))

vi.mock("../editable-node-label", () => ({
  EditableNodeLabel: ({ label }: { label?: string }) => <span>{label}</span>,
}))

vi.mock("../run-node-button", () => ({
  RunNodeButton: () => null,
}))

vi.mock("@/hooks/use-auto-execute", () => ({
  useAutoExecute: () => {},
}))

vi.mock("lucide-react", () => new Proxy({}, {
  get: (_t, prop) => (typeof prop === "string" && prop !== "then" ? () => null : undefined),
  has: () => true,
}))

vi.mock("@/hooks/use-workflow-store", () => ({
  useWorkflowStore: Object.assign(
    (selector: (s: Record<string, unknown>) => unknown) => selector({ runFromHere: () => {}, updateNodeData: () => {}, loadGeneration: 0 }),
    { getState: () => ({ nodes: [], edges: [] }) },
  ),
}))

const nodeProps = (id: string, data: Record<string, unknown>) => ({ id, data, selected: false }) as unknown as NodeProps

const renderSelector = (data: Record<string, unknown>) =>
  render(<SelectorNode {...nodeProps("pick", { label: "Material 1 prompt", config: { mode: "item" }, ...data })} />)

describe("SelectorNode", () => {
  it("shows the first picked item and the counts", () => {
    renderSelector({ pickedResults: ["A sneaker made of ice.", "Glass."], restResults: ["Moss."] })
    expect(screen.getByText("A sneaker made of ice.")).toBeInTheDocument()
    expect(screen.queryByText("Glass.")).toBeNull()
    expect(screen.getByText("2 picked · 1 rest · Mode: item")).toBeInTheDocument()
  })

  it("reads the live channel before the saved mirror, as every extractor does", () => {
    renderSelector({ __pickedResults: ["Live pick."], pickedResults: ["Stale pick."] })
    expect(screen.getByText("Live pick.")).toBeInTheDocument()
    expect(screen.queryByText("Stale pick.")).toBeNull()
  })

  it("keeps the empty state until something was picked", () => {
    renderSelector({})
    expect(screen.getByText("Mode: item")).toBeInTheDocument()
  })
})

describe("SplitTextNode", () => {
  it("shows the first part it cut", () => {
    render(<SplitTextNode {...nodeProps("split", { label: "Split", separator: "newline", splitResults: ["First part.", "Second part."] })} />)
    expect(screen.getByText("First part.")).toBeInTheDocument()
    expect(screen.queryByText("Second part.")).toBeNull()
  })
})

describe("textItems", () => {
  it("keeps only the non-blank strings", () => {
    expect(textItems(["A", " ", 3, null, "B"])).toEqual(["A", "B"])
    expect(textItems(undefined)).toEqual([])
  })
})
