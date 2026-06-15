import { render, screen, fireEvent } from "@testing-library/react"
import { describe, it, expect, vi, beforeEach } from "vitest"
import type { RunSlot } from "@/components/app-runner/types"
import type { WorkflowNode } from "@/types/nodes"

const state = vi.hoisted(() => ({
  appRunner: { executionStatus: "idle" as string, combinedProgress: {} as Record<string, number> },
  presentation: {
    run: vi.fn(),
    nodes: [] as unknown[],
    edges: [] as unknown[],
    inputValues: {} as Record<string, Record<string, unknown>>,
    updateInputValue: vi.fn(),
  },
}))
vi.mock("@/hooks/use-app-runner-store", () => ({ useAppRunnerStore: (sel: (s: unknown) => unknown) => sel(state.appRunner) }))
vi.mock("@/hooks/use-presentation-store", () => ({ usePresentationStore: (sel: (s: unknown) => unknown) => sel(state.presentation) }))

import { ChatView } from "../chat-view"

const node = (id: string, type: string): WorkflowNode =>
  ({ id, type, position: { x: 0, y: 0 }, data: { label: id } }) as WorkflowNode

const slot = (over: Partial<RunSlot>): RunSlot => ({
  id: "s", name: null, inputValues: {}, nodeStates: {}, executionId: null,
  executionStatus: "idle", completedNodes: 0, totalNodes: 0, creditsUsed: 0,
  createdAt: 0, version: null, thumbnailUrl: null, ...over,
})

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const baseProps: any = {
  orderedInputNodes: [node("t", "text-prompt")],
  orderedOutputNodes: [],
  renderInputCard: (n: WorkflowNode) => <div data-testid={`input-${n.id}`}>{n.id}</div>,
  renderOutputCard: () => null,
  getNodeStatus: () => "idle",
  getResult: () => ({}),
  getCardTitle: () => "",
  isEditing: false,
  sensors: [],
  handleInputDragEnd: () => {},
  handleOutputDragEnd: () => {},
  handleRemoveNode: () => {},
  handleRemoveItem: () => {},
  settings: {},
  updateCardMeta: () => {},
  setPickerSection: () => {},
}

beforeEach(() => {
  state.appRunner = { executionStatus: "idle", combinedProgress: {} }
  state.presentation = { run: vi.fn(), nodes: [], edges: [], inputValues: {}, updateInputValue: vi.fn() }
})

describe("ChatView", () => {
  it("shows the empty-state hero + composer when there are no runs", () => {
    render(<ChatView {...baseProps} appName="Ads Localizer" appDescription="Localize one ad." />)
    expect(screen.getByText("Ads Localizer")).toBeInTheDocument()
    expect(screen.getByText("Localize one ad.")).toBeInTheDocument()
    expect(screen.getByTestId("input-t")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /launch/i })).toBeInTheDocument()
  })

  it("calls run() on Launch", () => {
    render(<ChatView {...baseProps} />)
    fireEvent.click(screen.getByRole("button", { name: /launch/i }))
    expect(state.presentation.run).toHaveBeenCalledTimes(1)
  })

  it("locks the composer (disabled Launch → Running) while a run is in flight", () => {
    state.appRunner = { executionStatus: "running", combinedProgress: {} }
    render(<ChatView {...baseProps} />)
    const btn = screen.getByRole("button", { name: /running/i })
    expect(btn).toBeDisabled()
  })

  it("renders a thread message for a launched slot", () => {
    const runSlots = {
      slots: [slot({ id: "r1", executionStatus: "completed", inputValues: { t: { text: "hebrew" } } })],
      activeSlotId: "r1", handleCreateNew: vi.fn(), handleDuplicateSlot: vi.fn(), handleSelectSlot: vi.fn(),
    }
    render(<ChatView {...baseProps} runSlots={runSlots} />)
    expect(screen.getByText("hebrew")).toBeInTheDocument()
    expect(screen.getByText(/re-use inputs/i)).toBeInTheDocument()
  })

  it("mints the next draft when the active run reaches a terminal state", () => {
    const runSlots = {
      slots: [slot({ id: "r1", executionStatus: "running" })],
      activeSlotId: "r1", handleCreateNew: vi.fn(), handleDuplicateSlot: vi.fn(), handleSelectSlot: vi.fn(),
    }
    state.appRunner = { executionStatus: "running", combinedProgress: {} }
    const { rerender } = render(<ChatView {...baseProps} runSlots={runSlots} />)
    expect(runSlots.handleDuplicateSlot).not.toHaveBeenCalled()
    // transition running → completed
    state.appRunner = { executionStatus: "completed", combinedProgress: {} }
    rerender(<ChatView {...baseProps} runSlots={runSlots} />)
    expect(runSlots.handleDuplicateSlot).toHaveBeenCalledWith("r1")
  })
})
