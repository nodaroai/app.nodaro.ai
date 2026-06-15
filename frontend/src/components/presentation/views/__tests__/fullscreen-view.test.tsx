import { render, screen, fireEvent } from "@testing-library/react"
import { describe, it, expect, vi } from "vitest"
import { FullscreenView } from "../fullscreen-view"
import type { WorkflowNode } from "@/types/nodes"

const node = (id: string, type: string): WorkflowNode =>
  ({ id, type, position: { x: 0, y: 0 }, data: { label: id } }) as WorkflowNode

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const baseProps: any = {
  orderedInputNodes: [node("in1", "upload-image")],
  orderedOutputNodes: [node("out1", "generate-image")],
  getNodeStatus: () => "completed",
  getResult: (id: string) =>
    id === "in1" ? { url: "https://x/in.png" } : id === "out1" ? { url: "https://x/out.png" } : {},
  getCardTitle: (n: WorkflowNode) => (n.id === "in1" ? "Source" : "Result"),
  onBack: vi.fn(),
}

describe("FullscreenView keyboard nav", () => {
  it("lists inputs then outputs, each with a kind badge + node name", () => {
    render(<FullscreenView {...baseProps} />)
    expect(screen.getByText("input")).toBeInTheDocument()
    expect(screen.getByText("Source")).toBeInTheDocument()
  })

  it("ArrowRight advances to the next item (the output)", () => {
    render(<FullscreenView {...baseProps} />)
    fireEvent.keyDown(document, { key: "ArrowRight" })
    expect(screen.getByText("output")).toBeInTheDocument()
    expect(screen.getByText("Result")).toBeInTheDocument()
  })

  it("ArrowDown navigates to the next run via runSlots.handleSelectSlot", () => {
    const runSlots = {
      slots: [{ id: "a" }, { id: "b" }],
      activeSlotId: "a",
      handleCreateNew: vi.fn(),
      handleDuplicateSlot: vi.fn(),
      handleSelectSlot: vi.fn(),
    }
    render(<FullscreenView {...baseProps} runSlots={runSlots} />)
    fireEvent.keyDown(document, { key: "ArrowDown" })
    expect(runSlots.handleSelectSlot).toHaveBeenCalledWith("b")
  })

  it("Escape calls onBack", () => {
    render(<FullscreenView {...baseProps} />)
    fireEvent.keyDown(document, { key: "Escape" })
    expect(baseProps.onBack).toHaveBeenCalled()
  })
})

describe("FullscreenView overlay (chat result viewer)", () => {
  it("uses resolveResult to build items and seeds to initialNodeId", () => {
    const resolveResult = (id: string) =>
      id === "in1" ? { url: "https://frozen/in.png" } : id === "out1" ? { url: "https://frozen/out.png" } : {}
    render(
      <FullscreenView
        {...baseProps}
        asOverlay
        resolveResult={resolveResult}
        initialNodeId="out1"
      />,
    )
    // Seeded directly onto the output (index 1), not the first input.
    expect(screen.getByText("output")).toBeInTheDocument()
    expect(screen.getByText("Result")).toBeInTheDocument()
  })

  it("ArrowDown calls onRunChange instead of runSlots when provided", () => {
    const onRunChange = vi.fn()
    const runSlots = {
      slots: [{ id: "a" }, { id: "b" }],
      activeSlotId: "a",
      handleCreateNew: vi.fn(),
      handleDuplicateSlot: vi.fn(),
      handleSelectSlot: vi.fn(),
    }
    render(<FullscreenView {...baseProps} asOverlay runSlots={runSlots} onRunChange={onRunChange} />)
    fireEvent.keyDown(document, { key: "ArrowDown" })
    expect(onRunChange).toHaveBeenCalledWith(1)
    expect(runSlots.handleSelectSlot).not.toHaveBeenCalled()
  })

  it("renders a Close button in overlay mode", () => {
    render(<FullscreenView {...baseProps} asOverlay />)
    expect(screen.getByRole("button", { name: /close/i })).toBeInTheDocument()
  })

  it("re-points to the same node when a run switch reorders the item list", () => {
    // Run A: only the output resolves → items = [Result] (out1 at index 0).
    const onlyOutput = (id: string) => (id === "out1" ? { url: "https://a/out.png" } : {})
    const { rerender } = render(
      <FullscreenView {...baseProps} asOverlay resolveResult={onlyOutput} initialNodeId="out1" />,
    )
    expect(screen.getByText("Result")).toBeInTheDocument()
    // Run B: BOTH input and output resolve → items = [Source, Result]; out1 moves to index 1.
    const both = (id: string) =>
      id === "in1" ? { url: "https://b/in.png" } : id === "out1" ? { url: "https://b/out.png" } : {}
    rerender(<FullscreenView {...baseProps} asOverlay resolveResult={both} initialNodeId="out1" />)
    // Still showing the OUTPUT (out1), not the newly-prepended input — the seed re-pointed.
    expect(screen.getByText("output")).toBeInTheDocument()
    expect(screen.getByText("Result")).toBeInTheDocument()
  })
})
