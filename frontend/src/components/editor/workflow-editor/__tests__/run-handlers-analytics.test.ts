// A node's own ▶ runs in the browser, not through runWorkflow, so the run
// handler reports its `workflow_run` to the site analytics itself — once the
// server accepted the run (the node shows a job, or the run completed), once
// per click; never for a click a check or a server gate refuses.
import { describe, it, expect, vi, beforeEach } from "vitest"

const mockExecuteNode = vi.fn()
const mockGate = vi.fn()
const { trackEvent } = vi.hoisted(() => ({ trackEvent: vi.fn() }))

// A small stand-in for the workflow store, with the subscription the report watches.
type Node = { id: string; type: string; position: { x: number; y: number }; data: Record<string, unknown> }
const store = vi.hoisted(() => ({
  nodes: [] as Array<{ id: string; type: string; position: { x: number; y: number }; data: Record<string, unknown> }>,
  listeners: new Set<(state: unknown) => void>(),
}))
function setNodeData(id: string, patch: Record<string, unknown>) {
  store.nodes = store.nodes.map((n) => (n.id === id ? { ...n, data: { ...n.data, ...patch } } : n))
  const state = { nodes: store.nodes, edges: [] }
  for (const listener of [...store.listeners]) listener(state)
}

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() } }))
vi.mock("@/lib/analytics/site-analytics", () => ({ trackEvent }))
vi.mock("@/hooks/use-workflow-store", () => ({
  useWorkflowStore: {
    getState: () => ({
      nodes: store.nodes,
      edges: [],
      updateNodeData: vi.fn(),
      markNodesStatus: vi.fn(),
      isDirty: false,
      workflowId: "wf-mock-1",
    }),
    subscribe: (listener: (state: unknown) => void) => {
      store.listeners.add(listener)
      return () => store.listeners.delete(listener)
    },
  },
}))
vi.mock("@/lib/api", () => ({
  getJobStatusLean: vi.fn(),
  getUserCredits: vi.fn(),
  runWorkflow: vi.fn(),
  getWorkflowExecution: vi.fn(),
  streamWorkflowExecution: vi.fn(() => () => {}),
  withDedupRaceRetry: <T,>(fn: () => Promise<T>) => fn(),
  WorkflowAlreadyRunningError: class extends Error { executionId = "" },
  NodaroConnectionRequiredError: class extends Error {},
}))
vi.mock("@/lib/supabase", () => ({
  createClient: () => ({ auth: { getUser: vi.fn().mockResolvedValue({ data: { user: null } }) } }),
}))
vi.mock("@/hooks/use-auth", () => ({ getCachedUserId: () => "u1" }))
vi.mock("@/lib/edition", () => ({ hasCredits: () => false }))
vi.mock("@/lib/query-client", () => ({ queryClient: { fetchQuery: vi.fn() } }))
vi.mock("@/lib/query-keys", () => ({ queryKeys: { credits: { balance: (id: string) => ["credits", "balance", id] } } }))
vi.mock("@/ee/hooks/use-model-credits", () => ({ getCachedCredits: vi.fn() }))
vi.mock("../types", () => ({
  MAX_CONSECUTIVE_POLL_FAILURES: 5,
  updateAwaitingReviewIfChanged: vi.fn(),
  NODE_CREDIT_COSTS: {} as Record<string, number>,
  isExecutableNode: (n: { type?: string }) => n.type === "generate-image",
  getFanOutMultiplier: () => 1,
}))
vi.mock("../execution-graph", () => ({
  buildExecutionLevels: vi.fn(() => []),
  getEffectivelySkippedIds: vi.fn(() => new Set()),
  collapseExpandedClones: vi.fn(),
}))
vi.mock("../node-input-resolver", () => ({
  getListInputForNode: vi.fn(() => null),
  getListFanOutForNode: vi.fn(() => undefined),
}))
vi.mock("../execute-node", () => ({
  executeNode: (...args: unknown[]) => mockExecuteNode(...args),
  rejectAllManualEdits: vi.fn(),
}))
vi.mock("../list-execution", () => ({ executeNodeForList: vi.fn(), expandLoopResults: vi.fn() }))
vi.mock("../video-link-run-gate", () => ({ ensureVideoLinksBeforeRun: (...args: unknown[]) => mockGate(...args) }))

import { handleRunSingleNode } from "../run-handlers"

function makeCtx() {
  return {
    userId: "u1",
    projectId: "p1",
    trackInterval: (i: unknown) => i,
    untrackInterval: vi.fn(),
    isWorkflowStale: () => false,
    isStorageError: () => false,
    setShowStorageExceeded: vi.fn(),
    setStorageExceededData: vi.fn(),
    setShowInsufficientCredits: vi.fn(),
    setInsufficientCreditsData: vi.fn(),
  } as never
}

const run = () => handleRunSingleNode("n1", makeCtx(), "p1", vi.fn().mockResolvedValue(undefined), vi.fn(), { current: new Set() })
const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

beforeEach(() => {
  vi.clearAllMocks()
  store.listeners.clear()
  store.nodes = [{ id: "n1", type: "generate-image", position: { x: 0, y: 0 }, data: { label: "Generate Image" } } as Node]
  mockGate.mockResolvedValue(true)
})

describe("a node's ▶ → workflow_run", () => {
  it("counts once the server accepted the job, even when the job later fails, and only once", async () => {
    mockExecuteNode.mockImplementation(async () => {
      setNodeData("n1", { currentJobId: "job-1" })
      setNodeData("n1", { currentJobId: "job-1", progress: 50 })
      throw new Error("the provider failed")
    })
    expect(await run()).toBe(true)
    await settle()
    expect(trackEvent).toHaveBeenCalledTimes(1)
    expect(trackEvent).toHaveBeenCalledWith("workflow_run", { run_scope: "node" })
    expect(store.listeners.size).toBe(0)
  })

  it("counts a run that completes without a job of its own", async () => {
    mockExecuteNode.mockResolvedValue(undefined)
    expect(await run()).toBe(true)
    await settle()
    expect(trackEvent).toHaveBeenCalledTimes(1)
  })

  it("a run the server refused (no job, then a failure) is not counted", async () => {
    mockExecuteNode.mockRejectedValue(Object.assign(new Error("Not enough credits"), { status: 402 }))
    expect(await run()).toBe(true)
    await settle()
    expect(trackEvent).not.toHaveBeenCalled()
    expect(store.listeners.size).toBe(0)
  })

  it("a job left over from an earlier run is not this click's acceptance", async () => {
    store.nodes = [{ ...store.nodes[0]!, data: { label: "Generate Image", currentJobId: "job-old" } }]
    mockExecuteNode.mockImplementation(async () => {
      setNodeData("n1", { progress: 1 })
      throw new Error("refused")
    })
    await run()
    await settle()
    expect(trackEvent).not.toHaveBeenCalled()
  })

  it("a click a check refuses reports nothing", async () => {
    mockGate.mockResolvedValueOnce(false)
    expect(await run()).toBe(false)
    await settle()
    expect(trackEvent).not.toHaveBeenCalled()
  })
})
