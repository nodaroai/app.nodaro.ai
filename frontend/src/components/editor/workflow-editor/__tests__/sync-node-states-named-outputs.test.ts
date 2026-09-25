import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

// The LIVE lane of the three that paint an orchestrator's output onto a node
// (the other two are the load-time restores in use-workflow-persistence.ts).
// All three go through `namedRunOutputFields`; this pins the live one, so a
// future "just set it inline here" cannot make a result right while the tab is
// open and lost after a reload — which is what #1547 was, the other way round.

const mockStreamWorkflowExecution = vi.fn()
const mockGetWorkflowExecution = vi.fn()
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
  getWorkflowExecution: (...args: unknown[]) => mockGetWorkflowExecution(...args),
  streamWorkflowExecution: (...args: unknown[]) => mockStreamWorkflowExecution(...args),
}))
vi.mock("@/lib/supabase", () => ({
  createClient: () => ({ auth: { getUser: vi.fn().mockResolvedValue({ data: { user: null } }) } }),
}))
vi.mock("@/hooks/use-auth", () => ({ getCachedUserId: () => "u1" }))
vi.mock("@/lib/edition", () => ({ hasCredits: () => false }))
vi.mock("@/lib/query-client", () => ({ queryClient: { fetchQuery: vi.fn() } }))
vi.mock("@/lib/query-keys", () => ({
  queryKeys: { credits: { balance: (id: string) => ["credits", "balance", id] } },
}))
vi.mock("@/ee/hooks/use-model-credits", () => ({ getCachedCredits: vi.fn() }))
vi.mock("../types", () => ({
  WorkflowStaleError: class WorkflowStaleError extends Error {},
  MAX_CONSECUTIVE_POLL_FAILURES: 20,
  NODE_CREDIT_COSTS: {} as Record<string, number>,
  isExecutableNode: () => true,
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
// The clear module pulls the Preview collector (and through it the real
// execution graph); this lane needs neither.
vi.mock("../clear-run-results", () => ({ clearedConnectedListRows: () => null }))

import { streamBackendExecution, teardownActiveWorkflowStream } from "../run-handlers"
import { namedRunOutputFields } from "@/lib/named-run-outputs"
import { videoOverlayResultFresh } from "@/lib/video-overlay-composition"
import type { ExecutionContext } from "../types"

const ctx = {
  userId: "u1",
  projectId: "p1",
  trackInterval: (i: unknown) => i,
  untrackInterval: vi.fn(),
  save: vi.fn(),
  setIsRunning: vi.fn(),
  isWorkflowStale: () => false,
  isStorageError: () => false,
  setShowStorageExceeded: vi.fn(),
  setStorageExceededData: vi.fn(),
  setShowInsufficientCredits: vi.fn(),
  setInsufficientCreditsData: vi.fn(),
} as unknown as ExecutionContext

function sync(states: Record<string, unknown>) {
  const calls = mockStreamWorkflowExecution.mock.calls
  const callbacks = calls[calls.length - 1]?.[1] as { onNodeStatesChanged?: (s: Record<string, unknown>) => void }
  callbacks.onNodeStatesChanged?.(states)
  return Object.fromEntries(mockNodes.map((n) => [n.id, n.data]))
}

describe("syncNodeStatesToStore — a finished node's named side outputs", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    teardownActiveWorkflowStream()
    mockStreamWorkflowExecution.mockReturnValue(new Promise(() => {}))
    mockGetWorkflowExecution.mockResolvedValue({ status: "running", nodeStates: {} })
  })
  afterEach(() => {
    teardownActiveWorkflowStream()
    vi.useRealTimers()
  })

  it("lands every one of them under the name its reader uses — the same mapping the reload lanes apply", () => {
    const outputs = {
      sep: { vocalUrl: "https://cdn.test/vocals.mp3", instrumentalUrl: "https://cdn.test/inst.mp3" },
      align: { alignment: [{ word: "hi", start: 0, end: 1 }] },
      combine: { combinedText: "a b" },
      split: { splitResults: ["a", "b"] },
      voice: { generatedVoiceId: "voice-1" },
    }
    mockNodes = [
      { id: "sep", type: "suno-separate", data: { executionStatus: "running" } },
      { id: "align", type: "forced-alignment", data: { executionStatus: "running" } },
      { id: "combine", type: "combine-text", data: { executionStatus: "running" } },
      { id: "split", type: "split-text", data: { executionStatus: "running" } },
      { id: "voice", type: "voice-design", data: { executionStatus: "running" } },
    ]
    streamBackendExecution("exec-1", ctx, vi.fn(), vi.fn())
    const byId = sync(Object.fromEntries(Object.entries(outputs).map(([id, output]) => [id, { status: "completed", output }])))

    for (const [id, output] of Object.entries(outputs)) {
      expect(byId[id], id).toMatchObject(namedRunOutputFields(output))
    }
    expect(byId.sep.vocalUrl).toBe("https://cdn.test/vocals.mp3")
    expect(byId.align.alignmentResults).toEqual([{ word: "hi", start: 0, end: 1 }])
    expect(byId.combine.combinedText).toBe("a b")
    expect(byId.split.splitResults).toEqual(["a", "b"])
  })
})

// Video Overlay on a BACKEND run (Execute All, Run from here, schedule, webhook,
// app): the worker's warnings, canvas and length must reach the node exactly as
// the single-node Run writes them — the panel's "Last run" line reads the field
// whichever path ran — and a run without warnings must clear an earlier line.
describe("syncNodeStatesToStore — Video Overlay run facts", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    teardownActiveWorkflowStream()
    mockStreamWorkflowExecution.mockReturnValue(new Promise(() => {}))
    mockGetWorkflowExecution.mockResolvedValue({ status: "running", nodeStates: {} })
  })
  afterEach(() => {
    teardownActiveWorkflowStream()
    vi.useRealTimers()
  })

  const skipped = { layer: 1, slot: 2, code: "skipped", detail: "starts at 9 s, after the video ends (5.00 s)" }

  it("a backend-completed node carries the skipped warning, the canvas and the length — on the node and on the new result", () => {
    mockNodes = [{ id: "vo", type: "video-overlay", data: { executionStatus: "running" } }]
    streamBackendExecution("exec-1", ctx, vi.fn(), vi.fn())
    const byId = sync({
      vo: {
        status: "completed",
        jobId: "job-9",
        output: { videoUrl: "https://cdn.test/o.mp4", warnings: [skipped], width: 1080, height: 1920, durationSec: 5 },
      },
    })
    expect(byId.vo).toMatchObject({ executionStatus: "completed", generatedVideoUrl: "https://cdn.test/o.mp4", warnings: [skipped], width: 1080, height: 1920, durationSec: 5 })
    const [first] = byId.vo.generatedResults as Array<Record<string, unknown>>
    expect(first).toMatchObject({ url: "https://cdn.test/o.mp4", jobId: "job-9", warnings: [skipped], width: 1080, height: 1920, durationSec: 5 })
  })

  it("a backend run stamps the freshness key on the node and on the new result; an unstamped output leaves the result reading old", () => {
    mockNodes = [{ id: "vo", type: "video-overlay", data: { executionStatus: "running" } }]
    streamBackendExecution("exec-4", ctx, vi.fn(), vi.fn())
    const byId = sync({ vo: { status: "completed", jobId: "job-4", output: { videoUrl: "https://cdn.test/k.mp4", resultCompositionKey: "K1" } } })
    expect(byId.vo.resultCompositionKey).toBe("K1")
    const [first] = byId.vo.generatedResults as Array<Record<string, unknown>>
    expect(first).toMatchObject({ url: "https://cdn.test/k.mp4", resultCompositionKey: "K1" })

    mockNodes = [{ id: "vo", type: "video-overlay", data: { executionStatus: "running", resultCompositionKey: "K0" } }]
    streamBackendExecution("exec-5", ctx, vi.fn(), vi.fn())
    const unstamped = sync({ vo: { status: "completed", jobId: "job-5", output: { videoUrl: "https://cdn.test/u.mp4" } } })
    expect(unstamped.vo.resultCompositionKey).toBeUndefined()
    const [plain] = unstamped.vo.generatedResults as Array<Record<string, unknown>>
    expect(videoOverlayResultFresh("K1", plain)).toBe(false)
  })

  it("a list fan-out stamps each row with the key of the composition that produced it, not the node's", () => {
    mockNodes = [{ id: "vo", type: "video-overlay", data: { executionStatus: "running" } }]
    streamBackendExecution("exec-6", ctx, vi.fn(), vi.fn())
    const byId = sync({
      vo: {
        status: "completed",
        jobId: "job-c",
        jobIds: ["job-a", "job-c"],
        output: {
          videoUrl: "https://cdn.test/a.mp4",
          resultCompositionKey: "KA",
          listResults: ["https://cdn.test/a.mp4", "", "https://cdn.test/c.mp4"],
          listResultCompositionKeys: ["KA", "", "KC"],
        },
      },
    })
    const rows = byId.vo.generatedResults as Array<Record<string, unknown>>
    expect(rows.find((r) => r.url === "https://cdn.test/a.mp4")).toMatchObject({ resultCompositionKey: "KA" })
    expect(rows.find((r) => r.url === "https://cdn.test/c.mp4")).toMatchObject({ resultCompositionKey: "KC" })
  })

  it("a later run with no warnings clears the line an earlier single-node run left", () => {
    mockNodes = [
      { id: "vo", type: "video-overlay", data: { executionStatus: "running", warnings: [skipped], width: 720, height: 1280, durationSec: 9 } },
    ]
    streamBackendExecution("exec-2", ctx, vi.fn(), vi.fn())
    const byId = sync({ vo: { status: "completed", output: { videoUrl: "https://cdn.test/o2.mp4", width: 1080, height: 1920, durationSec: 5 } } })
    expect(byId.vo.warnings).toEqual([])
    expect(byId.vo).toMatchObject({ width: 1080, height: 1920, durationSec: 5 })
  })

  it("another node type is untouched by the mapping", () => {
    mockNodes = [{ id: "img", type: "image-overlay", data: { executionStatus: "running" } }]
    streamBackendExecution("exec-3", ctx, vi.fn(), vi.fn())
    const byId = sync({ img: { status: "completed", output: { imageUrl: "https://cdn.test/i.png" } } })
    expect("warnings" in byId.img).toBe(false)
  })
})
