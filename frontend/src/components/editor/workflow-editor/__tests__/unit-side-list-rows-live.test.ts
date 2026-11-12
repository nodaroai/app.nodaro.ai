// @test-watches frontend/src/nodes/**
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

/**
 * A node unit whose media take carries side outputs (a list of images and JSON
 * beside it — a split image's layers and their data), run by the server once
 * per upstream item: the LIVE lane (`syncNodeStatesToStore`) lands one take per
 * row, each with THAT row's side outputs (`listResultSideOutputs`, row-aligned
 * with `listResults` — backend fan-out-result.ts), and the node's own fields
 * hold every row's, row-aligned (the output's own side outputs). The two
 * load-time lanes are held to the same rows in
 * hooks/__tests__/unit-side-list-rows-load.test.ts. The unit is a fixture,
 * added through the editor's one door to the unit definitions.
 */

const mockStreamWorkflowExecution = vi.fn()
const mockGetWorkflowExecution = vi.fn()
let mockNodes: Array<{ id: string; type?: string; data: Record<string, unknown> }> = []

vi.mock("@/lib/unit-definitions", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/unit-definitions")>()
  const { FIXTURE_LAYERS_UNIT } = await import("./unit-side-list-rows.fixture")
  const units = [...real.UNIT_NODE_DEFINITIONS, FIXTURE_LAYERS_UNIT]
  return { ...real, UNIT_NODE_DEFINITIONS: units, unitDefinitionOf: (t: string | undefined) => units.find((u) => u.type === t) }
})
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
vi.mock("@/lib/query-keys", () => ({ queryKeys: { credits: { balance: (id: string) => ["credits", "balance", id] } } }))
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
vi.mock("../clear-run-results", () => ({ clearedConnectedListRows: () => null }))

import { streamBackendExecution, teardownActiveWorkflowStream } from "../run-handlers"
import { unitSideListRowFields } from "@/lib/json-run-result"
import type { ExecutionContext } from "../types"
import { BATCH_SIDE, FANNED_OUT_OUTPUT, FIXTURE_LAYERS_UNIT, ROW_A, ROW_B } from "./unit-side-list-rows.fixture"

const TYPE = FIXTURE_LAYERS_UNIT.type

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
  const ran = Object.fromEntries(Object.entries(states).map(([id, state]) => [id, { startedAt: "2026-11-11T10:00:00.000Z", ...(state as object) }]))
  callbacks.onNodeStatesChanged?.(ran)
  return Object.fromEntries(mockNodes.map((n) => [n.id, n.data]))
}

describe("unitSideListRowFields — each fan-out row's own side outputs, by its URL", () => {
  it("maps a row's unitLists / unitOutputs / unitListsNotSaved onto the unit's fields", () => {
    const row = unitSideListRowFields(TYPE, FANNED_OUT_OUTPUT)
    expect(row(ROW_A.url)).toEqual({ generatedLayerUrls: ROW_A.layers, layersNotSaved: 0, generatedLayerData: ROW_A.layerData })
    expect(row(ROW_B.url)).toEqual({ generatedLayerUrls: ROW_B.layers, layersNotSaved: 2, generatedLayerData: ROW_B.layerData })
  })

  it("a row with none, a URL no row names, and an output with no rows: every side field null (never the node's)", () => {
    const empty = { generatedLayerUrls: null, layersNotSaved: null, generatedLayerData: null }
    const output = { ...FANNED_OUT_OUTPUT, listResultSideOutputs: [FANNED_OUT_OUTPUT.listResultSideOutputs[0], null] }
    expect(unitSideListRowFields(TYPE, output)(ROW_B.url)).toEqual(empty)
    expect(unitSideListRowFields(TYPE, FANNED_OUT_OUTPUT)("https://r2/elsewhere.png")).toEqual(empty)
    expect(unitSideListRowFields(TYPE, { listResults: FANNED_OUT_OUTPUT.listResults })(ROW_A.url)).toEqual(empty)
  })

  it("every other node type gets nothing", () => {
    expect(unitSideListRowFields("generate-image", FANNED_OUT_OUTPUT)(ROW_A.url)).toEqual({})
    expect(unitSideListRowFields(undefined, FANNED_OUT_OUTPUT)(ROW_A.url)).toEqual({})
  })
})

describe("syncNodeStatesToStore — a unit with side outputs run once per upstream item", () => {
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

  it("lands one take per row, each with its own layers and layer data; the node's fields hold every row's", () => {
    mockNodes = [{ id: "split", type: TYPE, data: { executionStatus: "running" } }]
    streamBackendExecution("exec-1", ctx, vi.fn(), vi.fn())
    const byId = sync({ split: { status: "completed", jobId: "job-b", jobIds: ["job-a", "job-b"], output: FANNED_OUT_OUTPUT } })

    const takes = byId.split.generatedResults as Array<Record<string, unknown>>
    expect(takes.map((r) => r.url)).toEqual([ROW_A.url, ROW_B.url])
    expect(takes[0]).toMatchObject({ generatedLayerUrls: ROW_A.layers, generatedLayerData: ROW_A.layerData, layersNotSaved: 0 })
    expect(takes[1]).toMatchObject({ generatedLayerUrls: ROW_B.layers, generatedLayerData: ROW_B.layerData, layersNotSaved: 2 })
    expect(byId.split).toMatchObject({ generatedImageUrl: ROW_A.url, generatedLayerUrls: BATCH_SIDE.layers, generatedLayerData: BATCH_SIDE.layerData, layersNotSaved: BATCH_SIDE.notSaved })
  })
})
