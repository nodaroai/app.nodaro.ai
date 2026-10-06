import { describe, it, expect, vi, beforeEach } from "vitest"

// ---------------------------------------------------------------------------
// Mocks (the run-handlers harness, as in run-handlers-discard.test.ts)
// ---------------------------------------------------------------------------

let mockNodes: Array<{ id: string; type?: string; data: Record<string, unknown> }> = []

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn(), info: vi.fn(), warning: vi.fn() } }))

vi.mock("@/hooks/use-workflow-store", () => ({
  useWorkflowStore: {
    getState: () => ({ nodes: mockNodes, edges: [], updateNodeData: vi.fn() }),
    setState: (updater: unknown) => {
      const next =
        typeof updater === "function"
          ? (updater as (s: { nodes: typeof mockNodes }) => { nodes?: typeof mockNodes })({ nodes: mockNodes })
          : (updater as { nodes?: typeof mockNodes })
      if (next?.nodes) mockNodes = next.nodes
    },
  },
}))

vi.mock("@/lib/api", () => ({
  getJobStatusLean: vi.fn(),
  getUserCredits: vi.fn(),
  getWorkflowExecution: vi.fn(),
  streamWorkflowExecution: vi.fn(),
}))
vi.mock("@/lib/supabase", () => ({ createClient: () => ({ auth: { getUser: vi.fn().mockResolvedValue({ data: { user: null } }) } }) }))
vi.mock("@/hooks/use-auth", () => ({ getCachedUserId: () => "u1" }))
vi.mock("@/lib/edition", () => ({ hasCredits: () => false }))
vi.mock("@/lib/query-client", () => ({ queryClient: { fetchQuery: vi.fn() } }))
vi.mock("@/lib/query-keys", () => ({ queryKeys: { credits: { balance: (id: string) => ["credits", "balance", id] } } }))
vi.mock("@/ee/hooks/use-model-credits", () => ({ getCachedCredits: vi.fn() }))
vi.mock("../types", () => ({
  WorkflowStaleError: class WorkflowStaleError extends Error {
    constructor() { super("Workflow changed during execution") }
  },
  MAX_CONSECUTIVE_POLL_FAILURES: 20,
  NODE_CREDIT_COSTS: {} as Record<string, number>,
  isExecutableNode: (n: { type?: string }) => n.type === "llm-chat" || n.type === "text-to-speech",
}))
vi.mock("../execution-graph", () => ({
  buildExecutionLevels: vi.fn().mockReturnValue([]),
  getEffectivelySkippedIds: vi.fn().mockReturnValue(new Set()),
  collapseExpandedClones: vi.fn().mockReturnValue({ nodes: [], edges: [] }),
}))
vi.mock("../node-input-resolver", () => ({
  getListInputForNode: vi.fn().mockReturnValue(null),
  getListFanOutForNode: vi.fn().mockReturnValue(undefined),
}))
vi.mock("../execute-node", () => ({ executeNode: vi.fn().mockResolvedValue(undefined), rejectAllManualEdits: vi.fn() }))
vi.mock("../list-execution", () => ({ executeNodeForList: vi.fn().mockResolvedValue(undefined), expandLoopResults: vi.fn() }))

import { paintRunStates } from "../run-handlers"

const dataOf = (id: string) => mockNodes.find((n) => n.id === id)!.data

/**
 * A node the RUN skipped for want of input wears the reason as a chip
 * (`__runSkipReason`, a transient key — never saved) for the run that just
 * ended, and loses it the moment it runs again. A router-gated skip carries no
 * reason and settles idle, as before.
 */
describe("paintRunStates — the skip reason on the card", () => {
  beforeEach(() => {
    mockNodes = [
      { id: "llm", type: "llm-chat", data: { label: "Writer", executionStatus: "completed", generatedText: "old article" } },
      { id: "tts", type: "text-to-speech", data: { label: "Voice", executionStatus: "pending" } },
      { id: "gated", type: "llm-chat", data: { label: "Other branch", executionStatus: "pending" } },
    ]
  })

  it("paints the reason on a node skipped for want of input — without disturbing a result it still shows", () => {
    paintRunStates({
      llm: { status: "skipped", skipReason: "empty_input" },
      tts: { status: "skipped", skipReason: "empty_input" },
      gated: { status: "skipped" },
    })
    expect(dataOf("llm").__runSkipReason).toBe("empty_input")
    expect(dataOf("llm").executionStatus).toBe("completed")
    expect(dataOf("llm").generatedText).toBe("old article")
    expect(dataOf("tts")).toMatchObject({ __runSkipReason: "empty_input", executionStatus: "idle" })
    // A router-gated skip: idle, no chip.
    expect(dataOf("gated").executionStatus).toBe("idle")
    expect(dataOf("gated").__runSkipReason).toBeUndefined()
  })

  it("the chip goes the moment the node runs again, and when it completes or fails", () => {
    paintRunStates({ llm: { status: "skipped", skipReason: "empty_input" }, tts: { status: "skipped", skipReason: "empty_input" } })
    expect(dataOf("llm").__runSkipReason).toBe("empty_input")
    paintRunStates({ llm: { status: "running" }, tts: { status: "pending" } })
    expect(dataOf("llm").__runSkipReason).toBeUndefined()
    expect(dataOf("llm").executionStatus).toBe("running")
    expect(dataOf("tts").__runSkipReason).toBeUndefined()
    expect(dataOf("tts").executionStatus).toBe("pending")
    paintRunStates({ llm: { status: "skipped", skipReason: "empty_input" }, tts: { status: "skipped", skipReason: "empty_input" } })
    paintRunStates({
      llm: { status: "completed", output: { text: "fresh" }, startedAt: "2026-10-06T10:00:00Z", completedAt: "2026-10-06T10:00:05Z", jobId: "job-1" },
      tts: { status: "failed", error: "boom" },
    })
    expect(dataOf("llm").__runSkipReason).toBeUndefined()
    expect(dataOf("tts").__runSkipReason).toBeUndefined()
    expect(dataOf("tts").executionStatus).toBe("failed")
  })

  it("painting the same skip twice changes nothing more", () => {
    paintRunStates({ tts: { status: "skipped", skipReason: "empty_input" } })
    const before = mockNodes
    paintRunStates({ tts: { status: "skipped", skipReason: "empty_input" } })
    expect(mockNodes).toBe(before)
  })
})
