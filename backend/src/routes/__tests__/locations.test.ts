import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"

// ---------------------------------------------------------------------------
// Mocks — hoisted before any route import
// ---------------------------------------------------------------------------

vi.mock("@/lib/supabase.js", () => {
  const mockFrom = vi.fn()
  return {
    supabase: {
      from: mockFrom,
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: "user-123" } },
          error: null,
        }),
      },
    },
  }
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

vi.mock("@/lib/admin-check.js", () => ({
  warmAdminCache: vi.fn(),
  checkIsAdmin: vi.fn().mockResolvedValue(false),
}))

vi.mock("@/lib/url-validator.js", async () => {
  const { z } = await import("zod")
  return { safeUrlSchema: z.string().url() }
})

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import { locationRoutes } from "../locations.js"
import { supabase } from "../../lib/supabase.js"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TEST_USER_ID = "00000000-0000-4000-8000-000000000001"
const TEST_PROJECT_ID = "00000000-0000-4000-8000-000000000010"
const TEST_LOCATION_ID = "00000000-0000-4000-8000-000000000030"

const DB_LOCATION = {
  id: TEST_LOCATION_ID,
  user_id: TEST_USER_ID,
  node_id: "node-2",
  project_id: TEST_PROJECT_ID,
  name: "Forest",
  description: "A dark forest",
  category: "outdoor",
  style: "fantasy",
  source_image_url: "https://example.com/forest.png",
  time_of_day: [],
  weather: [],
  angles: [],
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
}

const CAMEL_LOCATION = {
  id: TEST_LOCATION_ID,
  userId: TEST_USER_ID,
  nodeId: "node-2",
  projectId: TEST_PROJECT_ID,
  name: "Forest",
  description: "A dark forest",
  category: "outdoor",
  style: "fantasy",
  sourceImageUrl: "https://example.com/forest.png",
  timeOfDay: [],
  weather: [],
  angles: [],
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
}

function mockListChain(result: { data: unknown; error: unknown }) {
  const chainable: Record<string, unknown> = {
    eq: vi.fn().mockReturnThis(),
  }
  chainable.then = (resolve: (value: { data: unknown; error: unknown }) => unknown) => Promise.resolve(result).then(resolve)
  const mockOrder = vi.fn().mockReturnValue(chainable)
  const mockSelect = vi.fn().mockReturnValue({ order: mockOrder })
  return { mockSelect, mockOrder, chainable }
}

let app: FastifyInstance

beforeEach(async () => {
  vi.clearAllMocks()
  app = Fastify({ logger: false })
  // Simulate auth middleware: set req.userId from X-User-Id header or userId in body
  app.addHook("preHandler", async (req) => {
    const header = req.headers["x-user-id"]
    if (typeof header === "string") {
      req.userId = header
    } else {
      const body = req.body as Record<string, unknown> | undefined
      if (body?.userId && typeof body.userId === "string") {
        req.userId = body.userId
      }
    }
  })
  await app.register(async (instance) => {
    await locationRoutes(instance)
  })
  await app.ready()
})

afterEach(async () => {
  await app.close()
})

// ---------------------------------------------------------------------------
// GET /v1/locations
// ---------------------------------------------------------------------------

describe("GET /v1/locations", () => {
  it("returns 200 with empty list", async () => {
    const { mockSelect } = mockListChain({ data: [], error: null })
    vi.mocked(supabase.from).mockReturnValue({ select: mockSelect } as never)

    const res = await app.inject({ method: "GET", url: "/v1/locations" })

    expect(res.statusCode).toBe(200)
    expect(res.json().locations).toEqual([])
  })

  it("returns 200 with camelCase-transformed data", async () => {
    const { mockSelect } = mockListChain({ data: [DB_LOCATION], error: null })
    vi.mocked(supabase.from).mockReturnValue({ select: mockSelect } as never)

    const res = await app.inject({ method: "GET", url: "/v1/locations" })

    expect(res.statusCode).toBe(200)
    expect(res.json().locations).toEqual([CAMEL_LOCATION])
  })

  it("returns 200 filtered by projectId query param", async () => {
    const { mockSelect, chainable } = mockListChain({ data: [], error: null })
    vi.mocked(supabase.from).mockReturnValue({ select: mockSelect } as never)

    const res = await app.inject({
      method: "GET",
      url: `/v1/locations?projectId=${TEST_PROJECT_ID}`,
    })

    expect(res.statusCode).toBe(200)
    expect(chainable.eq).toHaveBeenCalledWith("project_id", TEST_PROJECT_ID)
  })

  it("returns 500 on DB error", async () => {
    const { mockSelect } = mockListChain({
      data: null,
      error: { message: "DB down" },
    })
    vi.mocked(supabase.from).mockReturnValue({ select: mockSelect } as never)

    const res = await app.inject({ method: "GET", url: "/v1/locations" })

    expect(res.statusCode).toBe(500)
    expect(res.json().error.code).toBe("internal_error")
  })
})

// ---------------------------------------------------------------------------
// GET /v1/locations/:id
// ---------------------------------------------------------------------------

describe("GET /v1/locations/:id", () => {
  it("returns 200 with camelCase data", async () => {
    const mockSingle = vi.fn().mockResolvedValue({ data: DB_LOCATION, error: null })
    const mockEq = vi.fn().mockReturnValue({ single: mockSingle })
    const mockSelect = vi.fn().mockReturnValue({ eq: mockEq })
    vi.mocked(supabase.from).mockReturnValue({ select: mockSelect } as never)

    const res = await app.inject({
      method: "GET",
      url: `/v1/locations/${TEST_LOCATION_ID}`,
    })

    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual(CAMEL_LOCATION)
  })

  it("returns 404 on PGRST116 (not found)", async () => {
    const mockSingle = vi.fn().mockResolvedValue({
      data: null,
      error: { code: "PGRST116", message: "not found" },
    })
    const mockEq = vi.fn().mockReturnValue({ single: mockSingle })
    const mockSelect = vi.fn().mockReturnValue({ eq: mockEq })
    vi.mocked(supabase.from).mockReturnValue({ select: mockSelect } as never)

    const res = await app.inject({
      method: "GET",
      url: `/v1/locations/${TEST_LOCATION_ID}`,
    })

    expect(res.statusCode).toBe(404)
    expect(res.json().error.code).toBe("not_found")
  })

  it("returns 500 on DB error", async () => {
    const mockSingle = vi.fn().mockResolvedValue({
      data: null,
      error: { code: "OTHER", message: "DB error" },
    })
    const mockEq = vi.fn().mockReturnValue({ single: mockSingle })
    const mockSelect = vi.fn().mockReturnValue({ eq: mockEq })
    vi.mocked(supabase.from).mockReturnValue({ select: mockSelect } as never)

    const res = await app.inject({
      method: "GET",
      url: `/v1/locations/${TEST_LOCATION_ID}`,
    })

    expect(res.statusCode).toBe(500)
    expect(res.json().error.code).toBe("internal_error")
  })
})

// ---------------------------------------------------------------------------
// POST /v1/locations (upsert)
// ---------------------------------------------------------------------------

describe("POST /v1/locations", () => {
  it("returns 400 when name is missing", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/locations",
      payload: { nodeId: "node-2", userId: TEST_USER_ID },
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("validation_error")
  })

  it("returns 401 when userId is missing", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/locations",
      payload: { name: "Forest", nodeId: "node-2" },
    })
    expect(res.statusCode).toBe(401)
    expect(res.json().error.code).toBe("unauthorized")
  })

  it("returns 200 on insert (no id in body)", async () => {
    const mockSingle = vi.fn().mockResolvedValue({ data: { id: TEST_LOCATION_ID }, error: null })
    const mockSelect = vi.fn().mockReturnValue({ single: mockSingle })
    const mockInsert = vi.fn().mockReturnValue({ select: mockSelect })
    vi.mocked(supabase.from).mockReturnValue({ insert: mockInsert } as never)

    const res = await app.inject({
      method: "POST",
      url: "/v1/locations",
      payload: { name: "Forest", nodeId: "node-2", userId: TEST_USER_ID },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json().id).toBe(TEST_LOCATION_ID)
    expect(mockInsert).toHaveBeenCalledWith(
      expect.objectContaining({ name: "Forest", node_id: "node-2", user_id: TEST_USER_ID }),
    )
  })

  it("returns 200 on update (id in body)", async () => {
    const mockSingle = vi.fn().mockResolvedValue({ data: { id: TEST_LOCATION_ID }, error: null })
    const mockSelect = vi.fn().mockReturnValue({ single: mockSingle })
    const mockEq = vi.fn().mockReturnValue({ select: mockSelect })
    const mockUpdate = vi.fn().mockReturnValue({ eq: mockEq })
    vi.mocked(supabase.from).mockReturnValue({ update: mockUpdate } as never)

    const res = await app.inject({
      method: "POST",
      url: "/v1/locations",
      payload: {
        id: TEST_LOCATION_ID,
        name: "Forest Updated",
        nodeId: "node-2",
        userId: TEST_USER_ID,
      },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json().id).toBe(TEST_LOCATION_ID)
    expect(mockUpdate).toHaveBeenCalled()
  })

  it("returns 500 on DB error (insert)", async () => {
    const mockSingle = vi.fn().mockResolvedValue({
      data: null,
      error: { message: "insert failed" },
    })
    const mockSelect = vi.fn().mockReturnValue({ single: mockSingle })
    const mockInsert = vi.fn().mockReturnValue({ select: mockSelect })
    vi.mocked(supabase.from).mockReturnValue({ insert: mockInsert } as never)

    const res = await app.inject({
      method: "POST",
      url: "/v1/locations",
      payload: { name: "Forest", nodeId: "node-2", userId: TEST_USER_ID },
    })

    expect(res.statusCode).toBe(500)
    expect(res.json().error.code).toBe("internal_error")
  })
})

// ---------------------------------------------------------------------------
// DELETE /v1/locations/:id
// ---------------------------------------------------------------------------

describe("DELETE /v1/locations/:id", () => {
  it("returns 200 on success", async () => {
    const mockEq = vi.fn().mockResolvedValue({ error: null })
    const mockDelete = vi.fn().mockReturnValue({ eq: mockEq })
    vi.mocked(supabase.from).mockReturnValue({ delete: mockDelete } as never)

    const res = await app.inject({
      method: "DELETE",
      url: `/v1/locations/${TEST_LOCATION_ID}`,
    })

    expect(res.statusCode).toBe(200)
    expect(res.json().success).toBe(true)
  })

  it("returns 500 on DB error", async () => {
    const mockEq = vi.fn().mockResolvedValue({ error: { message: "FK constraint" } })
    const mockDelete = vi.fn().mockReturnValue({ eq: mockEq })
    vi.mocked(supabase.from).mockReturnValue({ delete: mockDelete } as never)

    const res = await app.inject({
      method: "DELETE",
      url: `/v1/locations/${TEST_LOCATION_ID}`,
    })

    expect(res.statusCode).toBe(500)
    expect(res.json().error.code).toBe("internal_error")
  })
})
