import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"

vi.mock("@/lib/supabase.js", () => {
  const mockFrom = vi.fn()
  return { supabase: { from: mockFrom } }
})

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
}))

vi.mock("@/ee/middleware/require-admin.js", () => ({
  requireAdmin: async () => {},
}))

import { adminPickerGapsRoutes } from "../admin-picker-gaps.js"
import { supabase } from "../../../lib/supabase.js"

let app: FastifyInstance

beforeEach(async () => {
  vi.clearAllMocks()
  app = Fastify({ logger: false })
  app.addHook("preHandler", async (req) => {
    const header = req.headers["x-user-id"]
    if (header && typeof header === "string") {
      req.userId = header
    }
  })
  await app.register(async (instance) => {
    await adminPickerGapsRoutes(instance)
  })
  await app.ready()
})

afterEach(async () => {
  await app.close()
})

/**
 * Build a Supabase query builder that is BOTH chainable (every method returns
 * the same builder) AND awaitable (it is a thenable resolving to the supplied
 * result). The GET route appends `.eq()` calls conditionally after `.range()`
 * then awaits the chain, so the terminus must support both. The returned
 * `eq` spy records the filter calls so the test can assert them.
 */
function buildAwaitableChain(result: { data: unknown[]; error: unknown; count?: number }) {
  const eq = vi.fn()
  const builder: Record<string, unknown> = {
    select: vi.fn(() => builder),
    order: vi.fn(() => builder),
    range: vi.fn(() => builder),
    update: vi.fn(() => builder),
    eq,
    then: (resolve: (v: typeof result) => unknown) => resolve(result),
  }
  eq.mockImplementation(() => builder)
  return { builder, eq }
}

describe("GET /v1/admin/picker-gaps", () => {
  it("returns gaps ranked by count and total, no filters", async () => {
    const row = {
      id: "00000000-0000-4000-8000-000000000aaa",
      picker_type: "person",
      gap_type: "item",
      dimension: "age",
      observed: "elderly with silver beard",
      chosen_id: "age-late-60s",
      count: 7,
      status: "new",
      first_seen: "2026-06-15T00:00:00.000Z",
      last_seen: "2026-06-15T01:00:00.000Z",
    }
    const { builder, eq } = buildAwaitableChain({ data: [row], error: null, count: 1 })
    vi.mocked(supabase.from).mockReturnValue(builder as never)

    const res = await app.inject({
      method: "GET",
      url: "/v1/admin/picker-gaps",
      headers: { "x-user-id": "00000000-0000-4000-8000-000000000001" },
    })

    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.data).toHaveLength(1)
    expect(body.data[0].picker_type).toBe("person")
    expect(body.data[0].count).toBe(7)
    expect(body.total).toBe(1)
    // No filter params supplied → no .eq() calls.
    expect(eq).not.toHaveBeenCalled()
  })

  it("applies picker / gapType / status filters", async () => {
    const { builder, eq } = buildAwaitableChain({ data: [], error: null, count: 0 })
    vi.mocked(supabase.from).mockReturnValue(builder as never)

    const res = await app.inject({
      method: "GET",
      url: "/v1/admin/picker-gaps?picker=styling&gapType=category&status=reviewed",
      headers: { "x-user-id": "00000000-0000-4000-8000-000000000001" },
    })

    expect(res.statusCode).toBe(200)
    expect(eq).toHaveBeenCalledWith("picker_type", "styling")
    expect(eq).toHaveBeenCalledWith("gap_type", "category")
    expect(eq).toHaveBeenCalledWith("status", "reviewed")
  })

  it("returns 500 on supabase error", async () => {
    const { builder } = buildAwaitableChain({ data: [], error: { message: "db boom" }, count: 0 })
    vi.mocked(supabase.from).mockReturnValue(builder as never)

    const res = await app.inject({
      method: "GET",
      url: "/v1/admin/picker-gaps",
      headers: { "x-user-id": "00000000-0000-4000-8000-000000000001" },
    })
    expect(res.statusCode).toBe(500)
    expect(res.json().error.message).toBe("db boom")
  })
})

describe("PATCH /v1/admin/picker-gaps/:id", () => {
  const validId = "00000000-0000-4000-8000-000000000aaa"

  it("updates the gap status", async () => {
    const { builder, eq } = buildAwaitableChain({ data: [], error: null })
    vi.mocked(supabase.from).mockReturnValue(builder as never)

    const res = await app.inject({
      method: "PATCH",
      url: `/v1/admin/picker-gaps/${validId}`,
      headers: { "x-user-id": "00000000-0000-4000-8000-000000000001" },
      payload: { status: "added" },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json().ok).toBe(true)
    expect(builder.update).toHaveBeenCalledWith({ status: "added" })
    expect(eq).toHaveBeenCalledWith("id", validId)
  })

  it("rejects an invalid id with 400", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: "/v1/admin/picker-gaps/not-a-uuid",
      headers: { "x-user-id": "00000000-0000-4000-8000-000000000001" },
      payload: { status: "added" },
    })
    expect(res.statusCode).toBe(400)
  })

  it("rejects an out-of-vocabulary status with 400", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: `/v1/admin/picker-gaps/${validId}`,
      headers: { "x-user-id": "00000000-0000-4000-8000-000000000001" },
      payload: { status: "acknowledged" },
    })
    expect(res.statusCode).toBe(400)
  })

  it("returns 500 on supabase error", async () => {
    const { builder } = buildAwaitableChain({ data: [], error: { message: "update boom" } })
    vi.mocked(supabase.from).mockReturnValue(builder as never)

    const res = await app.inject({
      method: "PATCH",
      url: `/v1/admin/picker-gaps/${validId}`,
      headers: { "x-user-id": "00000000-0000-4000-8000-000000000001" },
      payload: { status: "dismissed" },
    })
    expect(res.statusCode).toBe(500)
    expect(res.json().error.message).toBe("update boom")
  })
})
