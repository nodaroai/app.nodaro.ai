import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import type { ReactNode } from "react"

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockDiscard = vi.fn()
const mockStopAfter = vi.fn()
const mockGetWorkflowExecution = vi.fn()
const mockToastInfo = vi.fn()
const mockToastError = vi.fn()

vi.mock("@/lib/api", () => ({
  discardWorkflowExecution: (...a: unknown[]) => mockDiscard(...a),
  stopWorkflowExecution: (...a: unknown[]) => mockStopAfter(...a),
  getWorkflowExecution: (...a: unknown[]) => mockGetWorkflowExecution(...a),
}))

vi.mock("@/lib/edition", () => ({ hasCredits: () => false }))

vi.mock("sonner", () => ({
  toast: {
    info: (...a: unknown[]) => mockToastInfo(...a),
    error: (...a: unknown[]) => mockToastError(...a),
  },
}))

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import { ExecutionStatusBar, executionStatusRefetchInterval } from "../execution-status-bar"
import { NotFoundError } from "@nodaro/client"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function renderWithClient(ui: ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>)
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ExecutionStatusBar", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockDiscard.mockResolvedValue(undefined)
    mockStopAfter.mockResolvedValue(undefined)
  })

  it("shows 'Discarded' pill and disables the dropdown trigger when status is discarded", async () => {
    mockGetWorkflowExecution.mockResolvedValue({
      status: "discarded",
      completedNodes: 1,
      totalNodes: 3,
    })

    renderWithClient(
      <ExecutionStatusBar executionId="e1" onStopped={vi.fn()} onRunInstead={vi.fn()} />,
    )

    expect(await screen.findByText("Discarded")).toBeInTheDocument()
    // No spinner: the discarded pill renders a static StopCircle, not an
    // animated Loader2. Assert there is no animate-spin element.
    expect(document.querySelector(".animate-spin")).toBeNull()
    // The dropdown trigger is the only button — it must be disabled.
    await waitFor(() =>
      expect(screen.getByRole("button")).toBeDisabled(),
    )
  })

  it("clicking 'Discard' calls discardWorkflowExecution and onStopped", async () => {
    mockGetWorkflowExecution.mockResolvedValue({
      status: "running",
      completedNodes: 0,
      totalNodes: 2,
    })
    const onStopped = vi.fn()

    renderWithClient(
      <ExecutionStatusBar executionId="e2" onStopped={onStopped} onRunInstead={vi.fn()} />,
    )

    // Open the dropdown and click the Discard item.
    await userEvent.click(screen.getByRole("button"))
    const discardItem = await screen.findByText(/Discard \(save to Library/i)
    await userEvent.click(discardItem)

    await waitFor(() => expect(mockDiscard).toHaveBeenCalledWith("e2"))
    expect(onStopped).toHaveBeenCalledTimes(1)
    expect(mockToastInfo).toHaveBeenCalledWith(
      "Run discarded — in-flight results will be saved to My Library",
    )
  })

  it("clicking 'Run instead' calls onRunInstead", async () => {
    mockGetWorkflowExecution.mockResolvedValue({
      status: "running",
      completedNodes: 0,
      totalNodes: 2,
    })
    const onRunInstead = vi.fn()

    renderWithClient(
      <ExecutionStatusBar executionId="e3" onStopped={vi.fn()} onRunInstead={onRunInstead} />,
    )

    await userEvent.click(screen.getByRole("button"))
    const runInstead = await screen.findByText(/Run instead/i)
    await userEvent.click(runInstead)

    expect(onRunInstead).toHaveBeenCalledTimes(1)
  })
})

describe("executionStatusRefetchInterval", () => {
  it("keeps polling (3s) while the execution is still active", () => {
    expect(executionStatusRefetchInterval({ status: "running" }, null)).toBe(3000)
    expect(executionStatusRefetchInterval({ status: "pending" }, null)).toBe(3000)
    expect(executionStatusRefetchInterval(undefined, null)).toBe(3000)
  })

  it("stops polling once the run reaches a terminal status", () => {
    for (const s of ["completed", "failed", "cancelled", "timed_out", "discarded"]) {
      expect(executionStatusRefetchInterval({ status: s }, null)).toBe(false)
    }
  })

  it("stops polling when the execution 404s (row is gone — no 404 storm)", () => {
    expect(
      executionStatusRefetchInterval(undefined, new NotFoundError("Execution not found")),
    ).toBe(false)
  })

  it("keeps polling on a transient (non-404) error so a live run recovers", () => {
    expect(executionStatusRefetchInterval(undefined, new Error("network blip"))).toBe(3000)
  })
})
