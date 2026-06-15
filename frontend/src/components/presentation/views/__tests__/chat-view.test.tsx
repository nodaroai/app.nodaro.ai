import { render, screen, fireEvent } from "@testing-library/react"
import { describe, it, expect, vi, beforeEach } from "vitest"
import type { RunSlot } from "@/components/app-runner/types"
import type { WorkflowNode } from "@/types/nodes"

const state = vi.hoisted(() => ({
  appRunner: { runtimes: {} as Record<string, { combinedProgress: Record<string, number> }>, cancel: vi.fn() },
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
  state.appRunner = { runtimes: {}, cancel: vi.fn() }
  state.presentation = { run: vi.fn(), nodes: [], edges: [], inputValues: {}, updateInputValue: vi.fn() }
})

describe("ChatView", () => {
  it("shows the empty-state hero + composer chip bar when there are no runs", () => {
    render(<ChatView {...baseProps} appName="Ads Localizer" appDescription="Localize one ad." />)
    expect(screen.getByText("Ads Localizer")).toBeInTheDocument()
    expect(screen.getByText("Localize one ad.")).toBeInTheDocument()
    // The text input renders as a collapsed chip (its card opens in a popover).
    expect(screen.getByText("t")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /launch/i })).toBeInTheDocument()
  })

  it("calls run() on Launch", () => {
    render(<ChatView {...baseProps} />)
    fireEvent.click(screen.getByRole("button", { name: /launch/i }))
    expect(state.presentation.run).toHaveBeenCalledTimes(1)
  })

  it("shows a per-message Stop on a running run and cancels THAT run", () => {
    const cancel = vi.fn()
    state.appRunner = { runtimes: { r1: { combinedProgress: {} } }, cancel }
    const runSlots = {
      slots: [slot({ id: "r1", executionStatus: "running", inputValues: { t: { text: "go" } } })],
      activeSlotId: "r1", handleCreateNew: vi.fn(), handleDuplicateSlot: vi.fn(), handleSelectSlot: vi.fn(),
    }
    render(<ChatView {...baseProps} runSlots={runSlots} />)
    fireEvent.click(screen.getByRole("button", { name: /stop/i }))
    expect(cancel).toHaveBeenCalledWith("r1")
  })

  it("ignores a second Launch click while the first is still being set up (no double-charge)", () => {
    let resolveLaunch = () => {}
    const launch = vi.fn(() => new Promise<void>((r) => { resolveLaunch = r }))
    render(<ChatView {...baseProps} launch={launch} />)
    const btn = screen.getByRole("button", { name: /launch/i })
    fireEvent.click(btn)
    fireEvent.click(btn) // second click during the in-flight setup window
    expect(launch).toHaveBeenCalledTimes(1)
    resolveLaunch()
  })

  it("keeps the composer enabled while runs are in flight (concurrent launches)", () => {
    // A run for "r1" is live in the runtimes map; the composer must NOT lock —
    // the user can launch another run concurrently.
    state.appRunner = { runtimes: { r1: { combinedProgress: { out: 40 } } }, cancel: vi.fn() }
    render(<ChatView {...baseProps} />)
    expect(screen.getByRole("button", { name: /launch/i })).toBeEnabled()
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

  it("prefers launch() over run() on Launch, and preserves the draft (no auto-mint)", () => {
    const launch = vi.fn()
    const runSlots = {
      slots: [slot({ id: "r1", executionStatus: "running" })],
      activeSlotId: "r1", handleCreateNew: vi.fn(), handleDuplicateSlot: vi.fn(), handleSelectSlot: vi.fn(),
    }
    state.appRunner = { runtimes: { r1: { combinedProgress: {} } }, cancel: vi.fn() }
    render(<ChatView {...baseProps} runSlots={runSlots} launch={launch} />)
    // A live run must NOT auto-duplicate the slot anymore.
    expect(runSlots.handleDuplicateSlot).not.toHaveBeenCalled()
    // Launch routes to launch(), not run().
    fireEvent.click(screen.getByRole("button", { name: /launch/i }))
    expect(launch).toHaveBeenCalledTimes(1)
    expect(state.presentation.run).not.toHaveBeenCalled()
  })
})
