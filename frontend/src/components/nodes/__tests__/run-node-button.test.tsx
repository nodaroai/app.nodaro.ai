import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"

// ---- Mocks ----------------------------------------------------------------

// cancelJob (phase-aware) + abortNodeRun (streaming SSE abort).
const cancelJob = vi.fn((..._a: unknown[]) => Promise.resolve({ success: true, cancelled: 1 }))
vi.mock("@/lib/api", () => ({ cancelJob: (...a: unknown[]) => cancelJob(...a) }))

const abortNodeRun = vi.fn((..._a: unknown[]) => {})
vi.mock("@/lib/node-run-abort", () => ({ abortNodeRun: (...a: unknown[]) => abortNodeRun(...a) }))

// Confirm preference helpers — toggled per test via the refs below.
const shouldConfirmDiscard = vi.fn(() => false)
const suppressDiscardConfirm = vi.fn()
vi.mock("@/lib/run-confirm-pref", () => ({
  shouldConfirmDiscard: () => shouldConfirmDiscard(),
  suppressDiscardConfirm: () => suppressDiscardConfirm(),
}))

// Credit edition gate off — keeps the credit span out of the way (irrelevant here).
vi.mock("@/lib/edition", () => ({ hasCredits: () => false }))

// Fan-out resolver / shared repeat helpers are irrelevant to the discard flow.
vi.mock("@/components/editor/workflow-editor/node-input-resolver", () => ({
  getListInputForNode: () => null,
}))
vi.mock("@nodaro/shared", () => ({
  REPEATABLE_NODE_TYPES: new Set<string>(),
  getEffectiveRepeatCount: () => 1,
}))

vi.mock("lucide-react", () => {
  const I = (p: Record<string, unknown>) => <span data-testid="mock-icon" {...p} />
  return { FastForward: I, Play: I, Loader2: I, Trash2: I, RotateCcw: I }
})

// Thin shells for the Radix UI primitives. jsdom doesn't implement the pointer
// machinery (hasPointerCapture / PointerEvent) that the real DropdownMenu needs,
// so mock them to plain DOM that exercises the same handlers — mirroring how the
// other node tests mock heavy UI (base-node, createPortal, etc.).
vi.mock("@/components/ui/dropdown-menu", () => ({
  DropdownMenu: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  // asChild → render the child trigger button directly.
  DropdownMenuTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  DropdownMenuContent: ({ children, onClick }: { children: React.ReactNode; onClick?: (e: React.MouseEvent) => void }) => (
    <div data-testid="menu" onClick={onClick}>{children}</div>
  ),
  DropdownMenuItem: ({ children, onClick }: { children: React.ReactNode; onClick?: () => void }) => (
    <button type="button" onClick={onClick}>{children}</button>
  ),
}))

vi.mock("@/components/ui/alert-dialog", () => ({
  AlertDialog: ({ open, children }: { open: boolean; children: React.ReactNode }) =>
    open ? <div data-testid="confirm-dialog">{children}</div> : null,
  AlertDialogContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  AlertDialogHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  AlertDialogFooter: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  AlertDialogTitle: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  AlertDialogDescription: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  AlertDialogCancel: ({ children, onClick }: { children: React.ReactNode; onClick?: () => void }) => (
    <button type="button" onClick={onClick}>{children}</button>
  ),
  AlertDialogAction: ({ children, onClick }: { children: React.ReactNode; onClick?: () => void }) => (
    <button type="button" data-testid="confirm-action" onClick={onClick}>{children}</button>
  ),
}))

vi.mock("@/components/ui/checkbox", () => ({
  Checkbox: ({ checked, onCheckedChange }: { checked?: boolean; onCheckedChange?: (v: boolean) => void }) => (
    <input
      type="checkbox"
      aria-label="Don't ask again"
      checked={!!checked}
      onChange={(e) => onCheckedChange?.(e.target.checked)}
    />
  ),
}))

// Workflow store — mutable node data + updateNodeData spy. Mirrors how other
// node tests stub useWorkflowStore (selector + getState).
const updateNodeData = vi.fn()
let storeNode: { id: string; type: string; data: Record<string, unknown> }
function makeStore() {
  const state = {
    nodes: [storeNode],
    edges: [],
    updateNodeData,
  }
  const useWorkflowStore = Object.assign(
    (selector: (s: typeof state) => unknown) => selector(state),
    { getState: () => state },
  )
  return useWorkflowStore
}
vi.mock("@/hooks/use-workflow-store", () => ({
  get useWorkflowStore() {
    return makeStore()
  },
}))

import { RunNodeButton } from "../run-node-button"

const onRun = vi.fn()

function renderRunning(jobId: string | undefined = "job-old") {
  storeNode = {
    id: "node-1",
    type: "generate-image",
    data: { executionStatus: "running", currentJobId: jobId },
  }
  return render(
    <RunNodeButton nodeId="node-1" credits={0} isRunning onRun={onRun} />,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  shouldConfirmDiscard.mockReturnValue(false)
})

describe("RunNodeButton — discard run", () => {
  it("Discard clears currentJobId, reverts the node, and cancels the old job (confirm suppressed)", () => {
    renderRunning("job-old")
    fireEvent.click(screen.getByText("Discard"))

    expect(updateNodeData).toHaveBeenCalledWith(
      "node-1",
      expect.objectContaining({ currentJobId: undefined }),
    )
    expect(cancelJob).toHaveBeenCalledWith("job-old")
    expect(abortNodeRun).toHaveBeenCalledWith("node-1")
  })

  it("Run instead discards (clears currentJobId) BEFORE re-running, and runs once (confirm suppressed)", () => {
    renderRunning("job-old")
    fireEvent.click(screen.getByText("Run instead"))

    // Ordering: the revert (clearing currentJobId) must happen before onRun.
    const clearCall = updateNodeData.mock.invocationCallOrder[0]
    const runCall = onRun.mock.invocationCallOrder[0]
    expect(updateNodeData).toHaveBeenCalledWith(
      "node-1",
      expect.objectContaining({ currentJobId: undefined }),
    )
    expect(clearCall).toBeLessThan(runCall)
    expect(onRun).toHaveBeenCalledTimes(1)
    expect(onRun).toHaveBeenCalledWith("node-1")
  })

  it("Confirm dialog gates the action; confirming runs it; 'Don't ask again' suppresses future prompts", () => {
    shouldConfirmDiscard.mockReturnValue(true)
    renderRunning("job-old")

    // Clicking Discard opens the dialog but does NOT run the action yet.
    fireEvent.click(screen.getByText("Discard"))
    expect(screen.getByTestId("confirm-dialog")).toBeInTheDocument()
    expect(cancelJob).not.toHaveBeenCalled()
    expect(updateNodeData).not.toHaveBeenCalled()

    // Tick "Don't ask again", then confirm.
    fireEvent.click(screen.getByLabelText("Don't ask again"))
    fireEvent.click(screen.getByTestId("confirm-action"))

    expect(suppressDiscardConfirm).toHaveBeenCalledTimes(1)
    expect(cancelJob).toHaveBeenCalledWith("job-old")
    expect(updateNodeData).toHaveBeenCalledWith(
      "node-1",
      expect.objectContaining({ currentJobId: undefined }),
    )
  })

  it("does NOT keep a persistent 'Stopping…' pill after Discard", () => {
    renderRunning("job-old")
    fireEvent.click(screen.getByText("Discard"))
    expect(screen.queryByText(/Stopping/)).not.toBeInTheDocument()
  })
})
