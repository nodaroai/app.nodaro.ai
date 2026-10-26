import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ADMIN_UUID = "00000000-0000-4000-8000-000000000002"
const VALID_UUID = "00000000-0000-4000-8000-000000000001"

// ---------------------------------------------------------------------------
// Mocks — hoisted before any route/lib import
// ---------------------------------------------------------------------------

const mockFrom = vi.fn()
const cfg = vi.hoisted(() => ({ credits: false }))

vi.mock("@/lib/config.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/config.js")>()),
  hasCredits: () => cfg.credits,
}))

vi.mock("@/lib/supabase.js", () => ({
  supabase: {
    from: (...args: unknown[]) => mockFrom(...args),
  },
}))

vi.mock("@/ee/middleware/require-admin.js", () => ({
  requireAdmin: async (
    req: { userId?: string },
    reply: { status: (code: number) => { send: (body: unknown) => void } },
  ) => {
    if (req.userId !== ADMIN_UUID) {
      reply.status(403).send({ error: { code: "forbidden", message: "Admin access required" } })
    }
  },
}))

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import { adminJobsRoutes } from "../admin-jobs.js"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * A fluent jobs query whose terminal `await` resolves to `result`, exposing
 * the `range` spy so a test can assert offset paging.
 */
function jobsChain(result: { data: unknown; error: unknown }) {
  const chain: Record<string, ReturnType<typeof vi.fn>> = {}
  const self = () => chain
  chain.select = vi.fn().mockReturnValue(self())
  chain.order = vi.fn().mockReturnValue(self())
  chain.range = vi.fn().mockReturnValue(self())
  chain.eq = vi.fn().mockReturnValue(self())
  chain.not = vi.fn().mockReturnValue(self())
  chain.then = vi.fn().mockImplementation((resolve: (v: unknown) => void) => resolve(result))
  return chain
}

// ---------------------------------------------------------------------------
// Test app setup
// ---------------------------------------------------------------------------

let app: FastifyInstance

beforeEach(async () => {
  vi.clearAllMocks()
  app = Fastify({ logger: false })
  app.addHook("preHandler", async (req) => {
    const userId = req.headers["x-user-id"]
    if (typeof userId === "string") req.userId = userId
  })
  await app.register(async (instance) => {
    await adminJobsRoutes(instance)
  })
  await app.ready()
})

afterEach(async () => {
  await app.close()
})

function adminGet(url: string, userId = ADMIN_UUID) {
  return app.inject({ method: "GET", url, headers: { "x-user-id": userId } })
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("GET /v1/admin/jobs", () => {
  it("returns 403 for a non-admin", async () => {
    const res = await adminGet("/v1/admin/jobs", VALID_UUID)
    expect(res.statusCode).toBe(403)
    expect(res.json().error.code).toBe("forbidden")
  })

  it("rejects pageSize > 200 with 400", async () => {
    const res = await adminGet("/v1/admin/jobs?pageSize=999")
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("validation_error")
  })

  it("rejects a non-uuid in excludeUserIds with 400 (server validates what the browser used to interpolate raw)", async () => {
    const res = await adminGet("/v1/admin/jobs?excludeUserIds=not-a-uuid")
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("validation_error")
  })

  it("returns rows including the cost fields (admin route keeps cost, like sanitizeJobForPublic's admin branch)", async () => {
    const rows = [
      {
        id: "job-1",
        status: "completed",
        job_type: "generate-image",
        provider: "kie",
        provider_cost: 0.004,
        display_cost: 0.01,
        user_id: VALID_UUID,
      },
    ]
    mockFrom.mockReturnValue(jobsChain({ data: rows, error: null }))

    const res = await adminGet("/v1/admin/jobs?page=0&pageSize=50")
    expect(res.statusCode).toBe(200)
    const body = res.json()
    // No usage log, no hold: every credit figure is unknown.
    expect(body.data).toEqual(rows.map((r) => ({ ...r, credit: { status: null, charged: null, held: null, released: null, run: null } })))
    expect(body.data[0].provider_cost).toBe(0.004)
    expect(body.data[0].display_cost).toBe(0.01)
  })

  it("pages by offset — page=2 pageSize=50 asks for range(100, 149)", async () => {
    const chain = jobsChain({ data: [], error: null })
    mockFrom.mockReturnValue(chain)

    const res = await adminGet("/v1/admin/jobs?page=2&pageSize=50")
    expect(res.statusCode).toBe(200)
    expect(chain.range).toHaveBeenCalledWith(100, 149)
  })

  it("shows each job's settled charge beside its hold, and a parent's run total with its steps (never jobs.credits alone)", async () => {
    cfg.credits = true
    // The production Nodaro Motion preview: the parent and its video step,
    // both on the page (an admin list shows child jobs too).
    const page = [
      { id: "run", status: "completed", credits: 44, usage_log_id: "ul-run", user_id: VALID_UUID },
      { id: "video", status: "completed", credits: 3564, usage_log_id: "ul-video", user_id: VALID_UUID },
      { id: "live", status: "processing", credits: 120, usage_log_id: "ul-live", user_id: VALID_UUID },
    ]
    const steps = [{ id: "video", parent_job_id: "run", usage_log_id: "ul-video", credits: 3564 }]
    const logs = [
      { id: "ul-run", status: "committed", credits_used: 44, credits_charged: 44 },
      { id: "ul-video", status: "committed", credits_used: 3564, credits_charged: 854 },
      { id: "ul-live", status: "reserved", credits_used: 120, credits_charged: null },
    ]
    mockFrom.mockImplementation((table: string) => {
      let inArgs: [string, unknown[]] | null = null
      const chain: Record<string, unknown> = {}
      for (const op of ["select", "order", "range", "eq", "not"]) chain[op] = () => chain
      chain.in = (column: string, ids: unknown[]) => ((inArgs = [column, ids]), chain)
      chain.then = (resolve: (v: unknown) => unknown) => {
        if (table === "usage_logs") return resolve({ data: logs.filter((l) => inArgs![1].includes(l.id)), error: null })
        if (table === "jobs" && inArgs?.[0] === "parent_job_id") return resolve({ data: steps.filter((st) => inArgs![1].includes(st.parent_job_id)), error: null })
        if (table === "jobs") return resolve({ data: page, error: null })
        return resolve({ data: [], error: null })
      }
      return chain
    })

    const res = await adminGet("/v1/admin/jobs")
    expect(res.statusCode).toBe(200)
    const [run, video, live] = res.json().data
    expect(run.credit).toEqual({
      status: "committed", charged: 44, held: 44, released: 0,
      run: { steps: 1, charged: 898, held: 3608, released: 2710, settled: true },
    })
    expect(video.credit).toEqual({ status: "committed", charged: 854, held: 3564, released: 2710, run: null })
    expect(live.credit).toEqual({ status: "reserved", charged: null, held: 120, released: null, run: null })
    // The usage-log id is read for the charge only.
    expect(run).not.toHaveProperty("usage_log_id")
    cfg.credits = false
  })

  it("returns 500 when supabase errors", async () => {
    mockFrom.mockReturnValue(jobsChain({ data: null, error: { message: "boom" } }))
    const res = await adminGet("/v1/admin/jobs")
    expect(res.statusCode).toBe(500)
    expect(res.json().error.code).toBe("internal_error")
  })
})
