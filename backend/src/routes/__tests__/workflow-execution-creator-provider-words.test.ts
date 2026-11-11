/**
 * Whose run reads carry a failed node's provider words (`errorDetail` on a
 * run's node states) on routes/workflow-execution.ts (lib/provider-words.ts,
 * decided 2026-11-11). The words can quote the prompt of the workflow the run
 * executed, so whatever the `jobs.errorDetail` setting:
 *
 *  - a reader who can open the run's workflow (its creator, or a collaborator
 *    it is shared with) reads them where the deployment lets owners read them;
 *  - a reader whose own run executed someone else's workflow (a share link, a
 *    published app) never does, even with no setting;
 *  - an admin reader always does.
 *
 * The lookup of the reader's relation to the workflow is made only when a
 * state carries the words, the reader is not an admin and the setting is not
 * "admin" — otherwise the answer is the same either way and no read is made.
 * The setting alone, for the creator, is in workflow-execution-provider-words.test.ts.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"

const { mockCheckIsAdmin, mockWorkflowAccess, realAccess, sse } = vi.hoisted(() => ({
  mockCheckIsAdmin: vi.fn().mockResolvedValue(false),
  mockWorkflowAccess: vi.fn(),
  /** The real access rule, captured by the partial mock below. */
  realAccess: { fn: undefined as undefined | ((userId: string, workflowId: string) => Promise<string>) },
  sse: { events: [] as Array<{ type: string; data: Record<string, unknown> }> },
}))

vi.mock("@/lib/app-settings-version.js", () => ({
  appSettingsVersion: async () => null,
  appSettingsChangedSince: async () => false,
  forgetAppSettingsVersion: () => {},
}))
vi.mock("@/lib/supabase.js", () => ({ supabase: { from: vi.fn() } }))
// A surface profile is honoured on this edition (surfaceGateOpen: cloud); no organizations.
vi.mock("@/lib/config.js", () => ({
  config: { EDITION: "cloud", SUPABASE_URL: "https://test.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "test" },
  isCloud: () => true,
  hasCredits: () => true,
  isCommunity: () => false,
  isBusiness: () => false,
  hasAdmin: () => true,
  hasOrganizations: () => false,
}))
vi.mock("@/lib/admin-check.js", () => ({ warmAdminCache: vi.fn(), checkIsAdmin: mockCheckIsAdmin }))
vi.mock("@/lib/orchestration-queue.js", () => ({ orchestrationQueue: { add: vi.fn() } }))
vi.mock("@/lib/queue.js", () => ({
  videoQueue: { add: vi.fn(), getJob: vi.fn().mockResolvedValue(null), remove: vi.fn() },
  renderQueue: { add: vi.fn() },
  redis: {},
  tryRemoveFromQueue: vi.fn(),
}))
vi.mock("@/lib/concurrency-lanes/instance.js", () => ({ concurrencyGate: () => null }))
vi.mock("@/ee/billing/credits.js", () => ({ unpricedMeteredLlmOfRun: () => null, CreditsService: { refundCredits: vi.fn() } }))
vi.mock("@/ee/routes/credits.js", () => ({ invalidateBalanceCache: vi.fn() }))
vi.mock("@/ee/billing/balance-cache.js", () => ({ invalidateBalanceCache: vi.fn() }))
vi.mock("@/lib/app-reports.js", () => ({ insertAppReport: vi.fn(async () => true) }))
// The access rule, watched: the real one by default (no organizations: the
// creator owns a workflow, nobody else has anything); a test may answer "view"
// for a collaborator the workflow is shared with.
vi.mock("@/lib/workflow-access.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/workflow-access.js")>()
  realAccess.fn = actual.workflowAccess
  return { ...actual, workflowAccess: mockWorkflowAccess }
})
// The stream's events are recorded; closing it ends the response.
vi.mock("@/lib/sse.js", () => ({
  createSSEStream: vi.fn((_req: unknown, reply: { send: () => void }) => {
    let closed = false
    return {
      sendEvent: (event: { type: string; data: Record<string, unknown> }) => {
        if (!closed) sse.events.push(event)
      },
      sendComment: () => {},
      close: () => {
        if (closed) return
        closed = true
        reply.send()
      },
      get isClosed() {
        return closed
      },
    }
  }),
}))

import { workflowExecutionRoutes } from "../workflow-execution.js"
import { supabase } from "../../lib/supabase.js"
import { executionEvents } from "../../lib/execution-events.js"
import { __resetSurfaceProfileCacheForTests } from "../../lib/surface-profile.js"

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** The reader of every request: each run below is theirs. */
const READER = "00000000-0000-4000-8000-000000000001"
/** Someone else: the creator of a shared workflow or a published app. */
const OTHER = "00000000-0000-4000-8000-000000000003"
/** A workflow the reader created. */
const OWN_WF = "00000000-0000-4000-8000-000000000020"
/** A workflow someone else created (its share link, or the workflow of their published app). */
const SHARED_WF = "00000000-0000-4000-8000-000000000021"
const THIRD_WF = "00000000-0000-4000-8000-000000000022"
const CREATORS: Record<string, string> = { [OWN_WF]: READER, [SHARED_WF]: OTHER, [THIRD_WF]: OTHER }

const WORDS = "provider said: the prompt 'a red fox at dawn' was flagged"
const failedWithWords = () => ({ status: "failed", error: "Generation failed", errorDetail: WORDS, jobId: "j1" })
const failedWithoutWords = () => ({ status: "failed", error: "Generation failed", jobId: "j1" })
const completed = () => ({ status: "completed", output: { imageUrl: "https://cdn.example/x.png" }, jobId: "j2" })
const nodeStates = () => ({ n1: failedWithWords(), n2: completed() })
const statesWithoutWords = () => ({ n1: failedWithoutWords(), n2: completed() })

type States = Record<string, Record<string, unknown>>
type Row = Record<string, unknown>

let nextRun = 0
/** A failed run of `workflowId`, the reader's unless `userId` says otherwise. */
function run(workflowId: string, over: Row = {}): Row {
  nextRun += 1
  return {
    id: `00000000-0000-4000-8000-0000000001${String(nextRun).padStart(2, "0")}`,
    workflow_id: workflowId,
    user_id: READER,
    status: "failed",
    trigger_type: "manual",
    trigger_data: null,
    mcp_client: null,
    node_states: nodeStates(),
    total_nodes: 2,
    completed_nodes: 1,
    failed_nodes: 1,
    total_credits_used: 5,
    error_message: "Generation failed",
    started_at: "2026-01-01T00:01:00Z",
    completed_at: "2026-01-01T00:05:00Z",
    created_at: `2026-01-01T00:${String(nextRun % 60).padStart(2, "0")}:00Z`,
    updated_at: "2026-01-01T00:05:00Z",
    ...over,
  }
}

type Read = { table: string; columns?: string; filters: Record<string, unknown> }
/** Every `supabase.from(…)` the request made, with its select and its `eq` filters. */
const reads: Read[] = []
const NOT_FOUND = { data: null, error: { code: "PGRST116", message: "not found" } }

/**
 * `workflow_executions` holds `runs` (a list read gets them all, a `.single()`
 * the first); a by-id read of `workflows` gets that workflow's creator
 * (`CREATORS`); every other read finds nothing.
 */
function mockDb(runs: Row[]) {
  reads.length = 0
  vi.mocked(supabase.from).mockImplementation((table: string) => {
    const read: Read = { table, filters: {} }
    reads.push(read)
    const list = { data: table === "workflow_executions" ? runs : [], error: null }
    const single = () => {
      if (table === "workflow_executions") return runs[0] ? { data: runs[0], error: null } : NOT_FOUND
      const creator = table === "workflows" ? CREATORS[read.filters.id as string] : undefined
      return creator ? { data: { user_id: creator }, error: null } : NOT_FOUND
    }
    const proxy: unknown = new Proxy(() => {}, {
      get(_t, prop) {
        if (prop === "then") return (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) => Promise.resolve(list).then(ok, ko)
        if (prop === "single" || prop === "maybeSingle") return async () => single()
        if (prop === "select") return (columns: string) => ((read.columns = columns), proxy)
        if (prop === "eq") return (column: string, value: unknown) => ((read.filters[column] = value), proxy)
        return () => proxy
      },
    })
    return proxy as never
  })
}

/** The workflows whose creator was looked up to decide the words (never the list's name enrichment). */
const creatorLookups = () => reads.filter((r) => r.table === "workflows" && r.columns === "user_id").map((r) => r.filters.id)

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

const prevProfile = process.env.NODARO_SURFACE_PROFILE

function keepWordsForAdmins(): void {
  process.env.NODARO_SURFACE_PROFILE = JSON.stringify({ jobs: { errorDetail: "admin" } })
  __resetSurfaceProfileCacheForTests()
}

let app: FastifyInstance

beforeEach(async () => {
  vi.clearAllMocks()
  mockWorkflowAccess.mockReset()
  mockWorkflowAccess.mockImplementation((userId: string, workflowId: string) => realAccess.fn!(userId, workflowId))
  sse.events.length = 0
  delete process.env.NODARO_SURFACE_PROFILE
  __resetSurfaceProfileCacheForTests()
  app = Fastify({ logger: false })
  app.addHook("preHandler", async (req) => {
    req.userId = READER
    const role = req.headers["x-user-role"]
    req.userRole = typeof role === "string" ? (role as typeof req.userRole) : undefined
  })
  await app.register(async (instance) => {
    await workflowExecutionRoutes(instance)
  })
  await app.ready()
})

afterEach(async () => {
  executionEvents.removeAllListeners()
  await app.close()
  if (prevProfile === undefined) delete process.env.NODARO_SURFACE_PROFILE
  else process.env.NODARO_SURFACE_PROFILE = prevProfile
  __resetSurfaceProfileCacheForTests()
})

function get(url: string, role?: string) {
  return app.inject({ method: "GET", url, headers: role ? { "x-user-role": role } : {} })
}

// ---------------------------------------------------------------------------
// The reads, each answering every node-states snapshot the reader got
// ---------------------------------------------------------------------------

type ReadFn = (row: Row, role?: string) => Promise<States[]>

const detail: ReadFn = async (row, role) => {
  mockDb([row])
  const res = await get(`/v1/workflow-executions/${row.id}`, role)
  expect(res.statusCode).toBe(200)
  return [res.json().data.nodeStates]
}

const endedStream: ReadFn = async (row, role) => {
  mockDb([row])
  const res = await get(`/v1/workflow-executions/${row.id}/stream`, role)
  expect(res.statusCode).toBe(200)
  expect(sse.events.map((e) => e.type)).toEqual(["metadata", "done"])
  return sse.events.map((e) => e.data.nodeStates as States)
}

/** A running run (no node failed yet when the stream opens), then a node failing and the run ending. */
const liveStream: ReadFn = async (row, role) => {
  const id = row.id as string
  mockDb([{ ...row, status: "running", node_states: { n1: { status: "running", jobId: "j1" }, n2: completed() } }])
  const pending = get(`/v1/workflow-executions/${id}/stream`, role)
  await vi.waitFor(() => expect(executionEvents.listenerCount(id)).toBe(1))
  const counts = { completedNodes: 1, failedNodes: 1, totalNodes: 2 }
  executionEvents.emit(id, { type: "node:updated", executionId: id, nodeStates: row.node_states, nodeId: "n1", ...counts })
  executionEvents.emit(id, { type: "execution:failed", executionId: id, nodeStates: row.node_states, errorMessage: "Generation failed", ...counts })
  const res = await pending
  expect(res.statusCode).toBe(200)
  expect(sse.events.map((e) => e.type)).toEqual(["metadata", "execution", "done"])
  return sse.events.slice(1).map((e) => e.data.nodeStates as States)
}

const workflowList: ReadFn = async (row, role) => {
  mockDb([row])
  const res = await get(`/v1/workflows/${row.workflow_id}/executions`, role)
  expect(res.statusCode).toBe(200)
  return (res.json().data as Array<{ nodeStates: States }>).map((r) => r.nodeStates)
}

const globalList: ReadFn = async (row, role) => {
  mockDb([row])
  const res = await get("/v1/executions", role)
  expect(res.statusCode).toBe(200)
  return (res.json().data as Array<{ nodeStates: States }>).map((r) => r.nodeStates)
}

const READS: Array<[string, ReadFn]> = [
  ["GET /v1/workflow-executions/:id", detail],
  ["the stream of a run that has ended (metadata and done)", endedStream],
  ["the stream of a running run (its live events)", liveStream],
  ["GET /v1/workflows/:id/executions", workflowList],
  ["GET /v1/executions", globalList],
]

function expectWithheld(snapshots: States[]): void {
  expect(snapshots.length).toBeGreaterThan(0)
  for (const states of snapshots) {
    expect(states.n1).not.toHaveProperty("errorDetail")
    expect(states).toEqual(statesWithoutWords())
  }
}

function expectKept(snapshots: States[]): void {
  expect(snapshots.length).toBeGreaterThan(0)
  for (const states of snapshots) expect(states).toEqual(nodeStates())
}

// ==========================================================================

describe.each(READS)("%s — whose run carries a failed node's provider words", (_name, read) => {
  it("with no setting, the creator of the run's workflow reads them, after one lookup", async () => {
    expectKept(await read(run(OWN_WF)))
    expect(creatorLookups()).toEqual([OWN_WF])
    expect(mockWorkflowAccess).toHaveBeenCalledWith(READER, OWN_WF)
  })

  it.each([
    ["a share link", "manual"],
    ["a published app", "app_run"],
  ])("with no setting, a reader whose own run executed someone else's workflow through %s does not", async (_door, triggerType) => {
    expectWithheld(await read(run(SHARED_WF, { trigger_type: triggerType })))
    expect(creatorLookups()).toEqual([SHARED_WF])
  })

  it("with no setting, a collaborator who can open the workflow reads them", async () => {
    mockWorkflowAccess.mockImplementation(async () => "view")
    expectKept(await read(run(SHARED_WF)))
    expect(mockWorkflowAccess).toHaveBeenCalledTimes(1)
    expect(mockWorkflowAccess).toHaveBeenCalledWith(READER, SHARED_WF)
  })

  it("a lookup that fails counts as a reader who may not read them", async () => {
    mockWorkflowAccess.mockRejectedValue(new Error("connection reset"))
    expectWithheld(await read(run(OWN_WF)))
  })

  it.each(["admin", "super_admin"])("an %s reader reads them on a run of someone else's workflow, with no lookup", async (role) => {
    expectKept(await read(run(SHARED_WF), role))
    expect(creatorLookups()).toEqual([])
    expect(mockWorkflowAccess).not.toHaveBeenCalled()
  })

  it("kept for admins, the creator who is not an admin does not read them, and no lookup is made", async () => {
    keepWordsForAdmins()
    expectWithheld(await read(run(OWN_WF)))
    expect(creatorLookups()).toEqual([])
    expect(mockWorkflowAccess).not.toHaveBeenCalled()
  })

  it("kept for admins, an admin still reads them on someone else's workflow", async () => {
    keepWordsForAdmins()
    expectKept(await read(run(SHARED_WF), "admin"))
  })
})

describe.each(READS.filter(([, read]) => read !== liveStream))("%s — a run with no provider words to withhold", (_name, read) => {
  it("is served exactly as stored, and no lookup is made", async () => {
    const row = run(SHARED_WF, { node_states: statesWithoutWords() })
    for (const states of await read(row)) expect(states).toEqual(statesWithoutWords())
    expect(creatorLookups()).toEqual([])
    expect(mockWorkflowAccess).not.toHaveBeenCalled()
  })
})

describe("GET /v1/executions — runs of several workflows", () => {
  const byId = async (url: string, rows: Row[]) => {
    mockDb(rows)
    const res = await get(url)
    expect(res.statusCode).toBe(200)
    const data = res.json().data as Array<{ id: string; nodeStates: States }>
    expect(data.map((r) => r.id).sort()).toEqual(rows.map((r) => r.id as string).sort())
    return new Map(data.map((r) => [r.id, r.nodeStates]))
  }

  it("keeps the words on runs of the reader's own workflow only, looking each workflow up once", async () => {
    const own = run(OWN_WF)
    const shared = [run(SHARED_WF), run(SHARED_WF, { trigger_type: "app_run" })]
    const quiet = run(THIRD_WF, { node_states: statesWithoutWords() })
    const states = await byId("/v1/executions", [own, ...shared, quiet])
    expect(states.get(own.id as string)).toEqual(nodeStates())
    for (const row of shared) expect(states.get(row.id as string)).toEqual(statesWithoutWords())
    expect(states.get(quiet.id as string)).toEqual(statesWithoutWords())
    // One lookup per distinct workflow whose runs carry words; none for the quiet one.
    expect([...creatorLookups()].sort()).toEqual([OWN_WF, SHARED_WF].sort())
    expect(mockWorkflowAccess).toHaveBeenCalledTimes(2)
  })

  it("the admin view (viewAll, checked as an admin) keeps every row's words, whoever ran it, with no lookup", async () => {
    mockCheckIsAdmin.mockResolvedValueOnce(true)
    const rows = [run(SHARED_WF, { user_id: OTHER }), run(THIRD_WF, { user_id: OTHER, trigger_type: "app_run" }), run(OWN_WF)]
    const states = await byId("/v1/executions?viewAll=true", rows)
    for (const row of rows) expect(states.get(row.id as string)).toEqual(nodeStates())
    expect(mockCheckIsAdmin).toHaveBeenCalledWith(READER)
    expect(creatorLookups()).toEqual([])
    expect(mockWorkflowAccess).not.toHaveBeenCalled()
  })
})

describe("GET /v1/workflows/:id/executions — several runs of the one workflow", () => {
  const list = async (workflowId: string, rows: Row[]) => {
    mockDb(rows)
    const res = await get(`/v1/workflows/${workflowId}/executions`)
    expect(res.statusCode).toBe(200)
    const data = res.json().data as Array<{ id: string; nodeStates: States }>
    expect(data.map((r) => r.id).sort()).toEqual(rows.map((r) => r.id as string).sort())
    return data.map((r) => r.nodeStates)
  }

  it("the creator keeps every run's words, after one lookup of the route's workflow", async () => {
    expectKept(await list(OWN_WF, [run(OWN_WF), run(OWN_WF)]))
    expect(creatorLookups()).toEqual([OWN_WF])
  })

  it("a reader of someone else's workflow gets none of its runs' words, after one lookup", async () => {
    expectWithheld(await list(SHARED_WF, [run(SHARED_WF), run(SHARED_WF, { trigger_type: "app_run" })]))
    expect(creatorLookups()).toEqual([SHARED_WF])
  })
})

describe("the stream of a running run — one lookup for the whole stream", () => {
  it("asks once when the stream opens, not per event", async () => {
    expectKept(await liveStream(run(OWN_WF)))
    expect(creatorLookups()).toEqual([OWN_WF])
    expect(mockWorkflowAccess).toHaveBeenCalledTimes(1)
  })
})
