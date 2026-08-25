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
    expect(body.data).toEqual(rows)
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

  it("returns 500 when supabase errors", async () => {
    mockFrom.mockReturnValue(jobsChain({ data: null, error: { message: "boom" } }))
    const res = await adminGet("/v1/admin/jobs")
    expect(res.statusCode).toBe(500)
    expect(res.json().error.code).toBe("internal_error")
  })
})
