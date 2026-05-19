import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"

const ADMIN_UUID = "00000000-0000-4000-8000-000000000002"
const USER_UUID = "00000000-0000-4000-8000-000000000001"
const LOCATION_UUID = "11111111-1111-4000-8000-111111111111"

const mockFrom = vi.fn()

vi.mock("@/lib/supabase.js", () => ({
  supabase: {
    from: (...args: unknown[]) => mockFrom(...args),
    rpc: vi.fn(),
  },
}))

vi.mock("@/lib/config.js", () => ({
  config: {
    EDITION: "cloud",
    SUPABASE_URL: "https://test.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "test",
    R2_PUBLIC_URL: "https://r2.example.com",
  },
  isCloud: () => true,
  hasCredits: () => true,
  isCommunity: () => false,
  isBusiness: () => false,
  hasAdmin: () => true,
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

vi.mock("@/lib/storage.js", () => ({
  batchDeleteFromR2: vi.fn().mockResolvedValue({ deleted: 0, errors: 0 }),
}))

import { adminLocationRoutes } from "../admin-locations.js"

function supabaseChain(result: { data: unknown; error: unknown }): Record<string, ReturnType<typeof vi.fn>> {
  const chain: Record<string, ReturnType<typeof vi.fn>> = {}
  const self = () => chain

  chain.select = vi.fn().mockReturnValue(self())
  chain.insert = vi.fn().mockReturnValue(self())
  chain.update = vi.fn().mockReturnValue(self())
  chain.delete = vi.fn().mockReturnValue(self())
  chain.eq = vi.fn().mockReturnValue(self())
  chain.is = vi.fn().mockReturnValue(self())
  chain.not = vi.fn().mockReturnValue(self())
  chain.lt = vi.fn().mockReturnValue(self())
  chain.order = vi.fn().mockReturnValue(self())
  chain.limit = vi.fn().mockReturnValue(self())
  chain.single = vi.fn().mockResolvedValue(result)
  chain.maybeSingle = vi.fn().mockResolvedValue(result)
  chain.then = vi.fn().mockImplementation((resolve: (v: unknown) => void) => {
    resolve({ data: result.data, error: result.error })
  })
  return chain
}

let app: FastifyInstance

beforeEach(async () => {
  vi.clearAllMocks()
  app = Fastify({ logger: false })
  app.addHook("preHandler", async (req) => {
    const userId = req.headers["x-user-id"]
    if (typeof userId === "string") {
      req.userId = userId
    }
  })
  await app.register(async (instance) => {
    await adminLocationRoutes(instance)
  })
  await app.ready()
})

afterEach(async () => {
  await app.close()
})

describe("admin-locations routes", () => {
  it("403s when caller is not admin", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/admin/locations",
      headers: { "x-user-id": USER_UUID },
    })
    expect(res.statusCode).toBe(403)
  })

  it("GET /v1/admin/locations lists locations across all users", async () => {
    mockFrom.mockReturnValueOnce(
      supabaseChain({
        data: [
          { id: LOCATION_UUID, user_id: USER_UUID, name: "Old Library" },
        ],
        error: null,
      }),
    )
    const res = await app.inject({
      method: "GET",
      url: "/v1/admin/locations?limit=10",
      headers: { "x-user-id": ADMIN_UUID },
    })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.data).toHaveLength(1)
    expect(body.data[0].name).toBe("Old Library")
  })

  it("GET /v1/admin/locations/:id returns 404 when not found", async () => {
    mockFrom.mockReturnValueOnce(supabaseChain({ data: null, error: null }))
    const res = await app.inject({
      method: "GET",
      url: `/v1/admin/locations/${LOCATION_UUID}`,
      headers: { "x-user-id": ADMIN_UUID },
    })
    expect(res.statusCode).toBe(404)
  })

  it("PATCH /v1/admin/locations/:id updates fields and returns the row", async () => {
    mockFrom.mockReturnValueOnce(
      supabaseChain({
        data: { id: LOCATION_UUID, user_id: USER_UUID, name: "Renamed" },
        error: null,
      }),
    )
    const res = await app.inject({
      method: "PATCH",
      url: `/v1/admin/locations/${LOCATION_UUID}`,
      headers: { "x-user-id": ADMIN_UUID, "content-type": "application/json" },
      payload: JSON.stringify({ name: "Renamed" }),
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().name).toBe("Renamed")
  })

  it("PATCH /v1/admin/locations/:id can lift soft-delete by setting deletedAt=null", async () => {
    mockFrom.mockReturnValueOnce(
      supabaseChain({
        data: { id: LOCATION_UUID, deleted_at: null },
        error: null,
      }),
    )
    const res = await app.inject({
      method: "PATCH",
      url: `/v1/admin/locations/${LOCATION_UUID}`,
      headers: { "x-user-id": ADMIN_UUID, "content-type": "application/json" },
      payload: JSON.stringify({ deletedAt: null }),
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().deleted_at).toBeNull()
  })

  it("DELETE /v1/admin/locations/:id soft-deletes by default", async () => {
    mockFrom.mockReturnValueOnce(supabaseChain({ data: null, error: null }))
    const res = await app.inject({
      method: "DELETE",
      url: `/v1/admin/locations/${LOCATION_UUID}`,
      headers: { "x-user-id": ADMIN_UUID },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().permanent).toBe(false)
  })

  it("DELETE /v1/admin/locations/:id?permanent=true hard-deletes (no archive-first guard)", async () => {
    mockFrom
      // first call: SELECT for R2 key collection
      .mockReturnValueOnce(supabaseChain({ data: { id: LOCATION_UUID, source_image_url: null }, error: null }))
      // second call: DELETE
      .mockReturnValueOnce(supabaseChain({ data: null, error: null }))
    const res = await app.inject({
      method: "DELETE",
      url: `/v1/admin/locations/${LOCATION_UUID}?permanent=true`,
      headers: { "x-user-id": ADMIN_UUID },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ success: true, permanent: true })
  })

  it("DELETE /v1/admin/locations/:id?permanent=true returns 404 when row missing", async () => {
    mockFrom.mockReturnValueOnce(supabaseChain({ data: null, error: null }))
    const res = await app.inject({
      method: "DELETE",
      url: `/v1/admin/locations/${LOCATION_UUID}?permanent=true`,
      headers: { "x-user-id": ADMIN_UUID },
    })
    expect(res.statusCode).toBe(404)
  })
})
