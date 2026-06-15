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
