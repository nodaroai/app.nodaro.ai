import { describe, it, expect, vi, beforeEach } from "vitest"

// ---------------------------------------------------------------------------
// Mocks (declared before importing the module under test)
// ---------------------------------------------------------------------------

// streamWorkflowExecution dynamically imports streamGet from "@/lib/sse-client"
// and reads the Supabase session via getAuthHeaders → "@/lib/supabase".
const mockStreamGet = vi.fn()

vi.mock("@/lib/sse-client", () => ({
  streamGet: (...args: unknown[]) => mockStreamGet(...args),
}))

vi.mock("@/lib/supabase", () => ({
  createClient: () => ({
    auth: { getSession: vi.fn().mockResolvedValue({ data: { session: null } }) },
  }),
}))

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import { streamWorkflowExecution } from "../api"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeCallbacks() {
  return {
    onNodeStatesChanged: vi.fn(),
    onCompleted: vi.fn(),
    onFailed: vi.fn(),
    onCancelled: vi.fn(),
    onDiscarded: vi.fn(),
  }
}

/** Build an async generator yielding the given SSE events. */
function eventStream(events: Array<{ type: string; data: unknown }>) {
  return (async function* () {
    for (const e of events) yield e
  })()
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("streamWorkflowExecution — discarded done-event", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("routes a discarded done-event to onDiscarded WITHOUT painting nodeStates", async () => {
    mockStreamGet.mockReturnValue(
      eventStream([
        {
          type: "done",
          data: {
            eventType: "execution:discarded",
            // A discarded run still carries final nodeStates — these must NOT be
            // applied to the canvas.
            nodeStates: {
              "n1": { status: "completed", output: { imageUrl: "https://cdn.example.com/x.png" } },
            },
            completedNodes: 1,
            totalNodes: 2,
          },
        },
      ]),
    )

    const cb = makeCallbacks()
    await streamWorkflowExecution("exec-1", cb)

    expect(cb.onDiscarded).toHaveBeenCalledTimes(1)
    // The discarded states must never paint the canvas.
    expect(cb.onNodeStatesChanged).not.toHaveBeenCalled()
    // It must NOT fall through to onCompleted.
    expect(cb.onCompleted).not.toHaveBeenCalled()
    expect(cb.onFailed).not.toHaveBeenCalled()
    expect(cb.onCancelled).not.toHaveBeenCalled()
  })

  it("still routes a normal completed done-event through onNodeStatesChanged + onCompleted", async () => {
    mockStreamGet.mockReturnValue(
      eventStream([
        {
          type: "done",
          data: {
            eventType: "execution:completed",
            nodeStates: { "n1": { status: "completed" } },
            completedNodes: 2,
            totalNodes: 2,
          },
        },
      ]),
    )

    const cb = makeCallbacks()
    await streamWorkflowExecution("exec-2", cb)

    expect(cb.onNodeStatesChanged).toHaveBeenCalledTimes(1)
    expect(cb.onCompleted).toHaveBeenCalledTimes(1)
    expect(cb.onDiscarded).not.toHaveBeenCalled()
  })
})
