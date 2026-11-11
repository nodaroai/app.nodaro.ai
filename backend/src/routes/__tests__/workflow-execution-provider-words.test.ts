/**
 * A failed node's provider words (`errorDetail` on a run's node states) on the
 * run reads of routes/workflow-execution.ts, as the deployment's
 * `jobs.errorDetail` setting decides them (lib/provider-words.ts):
 *
 *  - no setting: the run's owner reads them, exactly as before;
 *  - "admin": a reader who is not an admin gets the node state without the
 *    key (every other field, and every other node, as it was); an admin reader
 *    still gets them.
 *
 * Covered: the detail read, the stream (its two snapshots and its live
 * events), both run lists, and `toExecutionSummary` on its own.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"

// ---------------------------------------------------------------------------
// Mocks — hoisted before any route import
// ---------------------------------------------------------------------------

const { mockCheckIsAdmin, sse } = vi.hoisted(() => ({
  mockCheckIsAdmin: vi.fn().mockResolvedValue(false),
  /** Every event the stream route sent, in order. */
  sse: { events: [] as Array<{ type: string; data: Record<string, unknown> }> },
}))

vi.mock("@/lib/app-settings-version.js", () => ({
  appSettingsVersion: async () => null,
  appSettingsChangedSince: async () => false,
  forgetAppSettingsVersion: () => {},
}))

vi.mock("@/lib/supabase.js", () => ({
  supabase: { from: vi.fn() },
}))

// A surface profile is honoured on this edition (surfaceGateOpen: cloud).
vi.mock("@/lib/config.js", () => ({
  config: {
    EDITION: "cloud",
    SUPABASE_URL: "https://test.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "test",
  },
  isCloud: () => true,
  hasCredits: () => true,
  isCommunity: () => false,
  isBusiness: () => false,
  hasAdmin: () => true,
  hasOrganizations: () => false,
}))

vi.mock("@/lib/admin-check.js", () => ({
  warmAdminCache: vi.fn(),
  checkIsAdmin: mockCheckIsAdmin,
}))

vi.mock("@/lib/orchestration-queue.js", () => ({
  orchestrationQueue: { add: vi.fn() },
}))

vi.mock("@/lib/queue.js", () => ({
  videoQueue: { add: vi.fn(), getJob: vi.fn().mockResolvedValue(null), remove: vi.fn() },
  renderQueue: { add: vi.fn() },
  redis: {},
  tryRemoveFromQueue: vi.fn(),
}))

vi.mock("@/lib/concurrency-lanes/instance.js", () => ({ concurrencyGate: () => null }))

vi.mock("@/ee/billing/credits.js", () => ({
  unpricedMeteredLlmOfRun: () => null,
  CreditsService: { refundCredits: vi.fn() },
}))
vi.mock("@/ee/routes/credits.js", () => ({ invalidateBalanceCache: vi.fn() }))
vi.mock("@/ee/billing/balance-cache.js", () => ({ invalidateBalanceCache: vi.fn() }))
vi.mock("@/lib/app-reports.js", () => ({ insertAppReport: vi.fn(async () => true) }))

// The stream's events are recorded; closing the stream ends the response, so
// app.inject() resolves once the route closes it.
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

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import { workflowExecutionRoutes, toExecutionSummary } from "../workflow-execution.js"
import { supabase } from "../../lib/supabase.js"
import { executionEvents } from "../../lib/execution-events.js"
import { __resetSurfaceProfileCacheForTests } from "../../lib/surface-profile.js"

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const TEST_USER_ID = "00000000-0000-4000-8000-000000000001"
const TEST_WORKFLOW_ID = "00000000-0000-4000-8000-000000000020"
const TEST_EXEC_ID = "00000000-0000-4000-8000-000000000060"

const WORDS = "provider said: the prompt 'a red fox at dawn' was flagged"

/** A failed node whose provider said why. */
const failedWithWords = () => ({ status: "failed", error: "Generation failed", errorDetail: WORDS, jobId: "j1" })
/** The same node as a reader who may not see the words gets it. */
const failedWithoutWords = () => ({ status: "failed", error: "Generation failed", jobId: "j1" })
/** A node the setting never touches. */
const completed = () => ({ status: "completed", output: { imageUrl: "https://cdn.example/x.png" }, jobId: "j2" })

const nodeStates = () => ({ n1: failedWithWords(), n2: completed() })

function executionRow(status = "failed", states: Record<string, unknown> = nodeStates()) {
  return {
    id: TEST_EXEC_ID,
    workflow_id: TEST_WORKFLOW_ID,
    user_id: TEST_USER_ID,
    status,
    trigger_type: "manual",
    trigger_data: null,
    mcp_client: null,
    node_states: states,
    total_nodes: 2,
    completed_nodes: 1,
    failed_nodes: 1,
    total_credits_used: 5,
    error_message: status === "failed" ? "Generation failed" : null,
    started_at: "2026-01-01T00:01:00Z",
    completed_at: status === "failed" ? "2026-01-01T00:05:00Z" : null,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:05:00Z",
  }
}

type Answer = { data: unknown; error: unknown }
const NOT_FOUND: Answer = { data: null, error: { code: "PGRST116", message: "not found" } }

/**
 * Every read answered by table: `workflow_executions` holds `row` (a list read
 * gets `[row]`, a `.single()` read gets the row); every other table holds
 * nothing (a list read gets `[]`, a `.single()` read misses).
 */
function mockReads(row: Record<string, unknown>) {
  vi.mocked(supabase.from).mockImplementation((table: string) => {
    const list: Answer = table === "workflow_executions" ? { data: [row], error: null } : { data: [], error: null }
    const single: Answer = table === "workflow_executions" ? { data: row, error: null } : NOT_FOUND
    const proxy: unknown = new Proxy(() => {}, {
      get(_t, prop) {
        if (prop === "then") return (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) => Promise.resolve(list).then(ok, ko)
        if (prop === "single" || prop === "maybeSingle") return async () => single
        return () => proxy
      },
    })
    return proxy as never
  })
}

// ---------------------------------------------------------------------------
// The setting
// ---------------------------------------------------------------------------

const prevProfile = process.env.NODARO_SURFACE_PROFILE

function keepWordsForAdmins(): void {
  process.env.NODARO_SURFACE_PROFILE = JSON.stringify({ jobs: { errorDetail: "admin" } })
  __resetSurfaceProfileCacheForTests()
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

let app: FastifyInstance

beforeEach(async () => {
  vi.clearAllMocks()
  sse.events.length = 0
  delete process.env.NODARO_SURFACE_PROFILE
  __resetSurfaceProfileCacheForTests()

  app = Fastify({ logger: false })
  app.addHook("preHandler", async (req) => {
    const header = req.headers["x-user-id"]
    if (typeof header === "string") {
      req.userId = header
      const role = req.headers["x-user-role"]
      req.userRole = typeof role === "string" ? (role as typeof req.userRole) : undefined
    }
  })
  await app.register(async (instance) => {
    await workflowExecutionRoutes(instance)
  })
  await app.ready()
})

afterEach(async () => {
  executionEvents.removeAllListeners(TEST_EXEC_ID)
  await app.close()
  if (prevProfile === undefined) delete process.env.NODARO_SURFACE_PROFILE
  else process.env.NODARO_SURFACE_PROFILE = prevProfile
  __resetSurfaceProfileCacheForTests()
})

/** A GET as the run's owner; `role` stands in for the reader's profile role. */
function get(url: string, role?: string) {
  return app.inject({
    method: "GET",
    url,
    headers: { "x-user-id": TEST_USER_ID, ...(role ? { "x-user-role": role } : {}) },
  })
}

type States = Record<string, Record<string, unknown>>

// ==========================================================================
// GET /v1/workflow-executions/:id
// ==========================================================================

describe("GET /v1/workflow-executions/:id — a failed node's provider words", () => {
  const read = async (role?: string) => {
    mockReads(executionRow())
    const res = await get(`/v1/workflow-executions/${TEST_EXEC_ID}`, role)
    expect(res.statusCode).toBe(200)
    return res.json().data.nodeStates as States
  }

  it("with no setting, the owner reads them as before", async () => {
    expect(await read()).toEqual(nodeStates())
  })

  it("kept for admins, a reader who is not an admin gets the node without them and every other field as it was", async () => {
    keepWordsForAdmins()
    const states = await read()
    expect(states.n1).not.toHaveProperty("errorDetail")
    expect(states.n1).toEqual(failedWithoutWords())
    expect(states.n2).toEqual(completed())
  })

  it.each(["admin", "super_admin"])("kept for admins, an %s reader still reads them", async (role) => {
    keepWordsForAdmins()
    expect(await read(role)).toEqual(nodeStates())
  })
})

// ==========================================================================
// GET /v1/workflow-executions/:id/stream
// ==========================================================================

describe("GET /v1/workflow-executions/:id/stream — a failed node's provider words", () => {
  describe("a run that has ended: the metadata and done snapshots", () => {
    const stream = async (role?: string) => {
      mockReads(executionRow("failed"))
      const res = await get(`/v1/workflow-executions/${TEST_EXEC_ID}/stream`, role)
      expect(res.statusCode).toBe(200)
      expect(sse.events.map((e) => e.type)).toEqual(["metadata", "done"])
      return sse.events.map((e) => e.data.nodeStates as States)
    }

    it("with no setting, both snapshots carry them as before", async () => {
      for (const states of await stream()) expect(states).toEqual(nodeStates())
    })

    it("kept for admins, neither snapshot carries them to a reader who is not an admin", async () => {
      keepWordsForAdmins()
      for (const states of await stream()) {
        expect(states.n1).not.toHaveProperty("errorDetail")
        expect(states.n1).toEqual(failedWithoutWords())
        expect(states.n2).toEqual(completed())
      }
    })

    it("kept for admins, both snapshots still carry them to an admin reader", async () => {
      keepWordsForAdmins()
      for (const states of await stream("admin")) expect(states).toEqual(nodeStates())
    })
  })

  describe("a running run: its live events", () => {
    /**
     * Opens the stream on a running run, then emits two orchestrator events
     * while it is open — a node that failed with words, then the run's end —
     * and answers each event the route sent: the metadata snapshot, the live
     * `execution` event and the `done` event.
     */
    const streamLive = async (role?: string) => {
      // The snapshot read before any event: no node has failed yet.
      mockReads(executionRow("running", { n1: { status: "running", jobId: "j1" }, n2: completed() }))
      const pending = get(`/v1/workflow-executions/${TEST_EXEC_ID}/stream`, role)
      await vi.waitFor(() => expect(executionEvents.listenerCount(TEST_EXEC_ID)).toBe(1))

      executionEvents.emit(TEST_EXEC_ID, {
        type: "node:updated",
        executionId: TEST_EXEC_ID,
        nodeStates: nodeStates(),
        nodeId: "n1",
        completedNodes: 1,
        failedNodes: 1,
        totalNodes: 2,
      })
      executionEvents.emit(TEST_EXEC_ID, {
        type: "execution:failed",
        executionId: TEST_EXEC_ID,
        nodeStates: nodeStates(),
        completedNodes: 1,
        failedNodes: 1,
        totalNodes: 2,
        errorMessage: "Generation failed",
      })

      const res = await pending
      expect(res.statusCode).toBe(200)
      expect(sse.events.map((e) => e.type)).toEqual(["metadata", "execution", "done"])
      // The terminal event ended the subscription.
      expect(executionEvents.listenerCount(TEST_EXEC_ID)).toBe(0)
      return sse.events.slice(1).map((e) => e.data)
    }

    it("with no setting, every live event carries them as before", async () => {
      const [live, done] = await streamLive()
      expect(live.eventType).toBe("node:updated")
      expect(live.nodeStates).toEqual(nodeStates())
      expect(done.eventType).toBe("execution:failed")
      expect(done.nodeStates).toEqual(nodeStates())
    })

    it("kept for admins, no live event carries them to a reader who is not an admin, and the rest of each event is as it was", async () => {
      keepWordsForAdmins()
      const [live, done] = await streamLive()
      for (const event of [live, done]) {
        const states = event.nodeStates as States
        expect(states.n1).not.toHaveProperty("errorDetail")
        expect(states.n1).toEqual(failedWithoutWords())
        expect(states.n2).toEqual(completed())
        expect(event.completedNodes).toBe(1)
        expect(event.failedNodes).toBe(1)
        expect(event.totalNodes).toBe(2)
      }
      expect(live.nodeId).toBe("n1")
      expect(done.errorMessage).toBe("Generation failed")
    })

    it("kept for admins, every live event still carries them to an admin reader", async () => {
      keepWordsForAdmins()
      const [live, done] = await streamLive("super_admin")
      expect(live.nodeStates).toEqual(nodeStates())
      expect(done.nodeStates).toEqual(nodeStates())
    })
  })
})

// ==========================================================================
// GET /v1/workflows/:id/executions
// ==========================================================================

describe("GET /v1/workflows/:id/executions — a failed node's provider words in the list rows", () => {
  const list = async (role?: string) => {
    mockReads(executionRow())
    const res = await get(`/v1/workflows/${TEST_WORKFLOW_ID}/executions`, role)
    expect(res.statusCode).toBe(200)
    const rows = res.json().data as Array<{ id: string; nodeStates: States }>
    expect(rows.map((r) => r.id)).toEqual([TEST_EXEC_ID])
    return rows[0]!.nodeStates
  }

  it("with no setting, the owner reads them as before", async () => {
    expect(await list()).toEqual(nodeStates())
  })

  it("kept for admins, a reader who is not an admin gets the row's node without them", async () => {
    keepWordsForAdmins()
    const states = await list()
    expect(states.n1).not.toHaveProperty("errorDetail")
    expect(states.n1).toEqual(failedWithoutWords())
    expect(states.n2).toEqual(completed())
  })

  it("kept for admins, an admin reader still reads them", async () => {
    keepWordsForAdmins()
    expect(await list("admin")).toEqual(nodeStates())
  })
})

// ==========================================================================
// GET /v1/executions
// ==========================================================================

describe("GET /v1/executions — a failed node's provider words in the list rows", () => {
  const list = async (query: string, role?: string) => {
    mockReads(executionRow())
    const res = await get(`/v1/executions${query}`, role)
    expect(res.statusCode).toBe(200)
    const rows = res.json().data as Array<{ id: string; nodeStates: States }>
    expect(rows.map((r) => r.id)).toEqual([TEST_EXEC_ID])
    return rows[0]!.nodeStates
  }

  it("with no setting, the owner's own list carries them as before", async () => {
    expect(await list("")).toEqual(nodeStates())
  })

  it("kept for admins, the own list of a reader who is not an admin carries none", async () => {
    keepWordsForAdmins()
    const states = await list("")
    expect(states.n1).not.toHaveProperty("errorDetail")
    expect(states.n1).toEqual(failedWithoutWords())
    expect(states.n2).toEqual(completed())
  })

  it("kept for admins, an admin's own list still carries them", async () => {
    keepWordsForAdmins()
    expect(await list("", "admin")).toEqual(nodeStates())
  })

  it("kept for admins, the admin view of every run (viewAll, checked as an admin) still carries them", async () => {
    keepWordsForAdmins()
    mockCheckIsAdmin.mockResolvedValueOnce(true)
    // No profile role on the request: the admin check of the view decides.
    expect(await list("?viewAll=true")).toEqual(nodeStates())
    expect(mockCheckIsAdmin).toHaveBeenCalledWith(TEST_USER_ID)
  })
})

// ==========================================================================
// toExecutionSummary
// ==========================================================================

describe("toExecutionSummary — with no reader named, the reader is not an admin", () => {
  it("with no setting, keeps them", () => {
    const summary = toExecutionSummary(executionRow()) as { nodeStates: States }
    expect(summary.nodeStates).toEqual(nodeStates())
  })

  it("kept for admins, withholds them and leaves every other field and node as it was", () => {
    keepWordsForAdmins()
    const summary = toExecutionSummary(executionRow()) as { nodeStates: States }
    expect(summary.nodeStates.n1).not.toHaveProperty("errorDetail")
    expect(summary.nodeStates.n1).toEqual(failedWithoutWords())
    expect(summary.nodeStates.n2).toEqual(completed())
  })

  it("kept for admins, keeps them for a reader named as an admin", () => {
    keepWordsForAdmins()
    const summary = toExecutionSummary(executionRow(), true) as { nodeStates: States }
    expect(summary.nodeStates).toEqual(nodeStates())
  })

  it("never changes the row it was given", () => {
    keepWordsForAdmins()
    const row = executionRow()
    toExecutionSummary(row)
    expect(row.node_states).toEqual(nodeStates())
  })
})
