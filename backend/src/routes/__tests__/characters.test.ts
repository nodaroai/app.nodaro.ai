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

import { characterRoutes } from "../characters.js"
import { supabase } from "../../lib/supabase.js"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TEST_USER_ID = "00000000-0000-4000-8000-000000000001"
const TEST_PROJECT_ID = "00000000-0000-4000-8000-000000000010"
const TEST_CHARACTER_ID = "00000000-0000-4000-8000-000000000020"

const DB_CHARACTER = {
  id: TEST_CHARACTER_ID,
  user_id: TEST_USER_ID,
  node_id: "node-1",
  project_id: TEST_PROJECT_ID,
  name: "Hero",
  description: "Main character",
  gender: "male",
  style: "realistic",
  base_outfit: "armor",
  source_image_url: "https://example.com/hero.png",
  expressions: [],
  poses: [],
  lighting_variations: [],
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
}

const CAMEL_CHARACTER = {
  id: TEST_CHARACTER_ID,
  userId: TEST_USER_ID,
  nodeId: "node-1",
  projectId: TEST_PROJECT_ID,
  name: "Hero",
  description: "Main character",
  gender: "male",
  style: "realistic",
  baseOutfit: "armor",
  sourceImageUrl: "https://example.com/hero.png",
  expressions: [],
  poses: [],
  lightingVariations: [],
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
}

// GET /v1/characters/:id now appends pendingJobs; the listing endpoint does not.
const CAMEL_CHARACTER_WITH_PENDING = { ...CAMEL_CHARACTER, pendingJobs: [] }

/**
 * Build a chain for the GET /:id route's secondary `jobs` query
 * (`.from("jobs").select().eq().in().filter()`). Resolves to `{ data, error }`
 * via a thenable so the route can `await` it.
 */
function mockJobsPendingChain(result: { data: unknown; error: unknown } = { data: [], error: null }) {
  const chain: Record<string, unknown> = {
    eq: vi.fn().mockReturnThis(),
    in: vi.fn().mockReturnThis(),
    filter: vi.fn().mockReturnThis(),
  }
  ;(chain as { then: (resolve: (value: unknown) => unknown) => unknown }).then = (resolve) =>
    Promise.resolve(result).then(resolve)
  const mockSelect = vi.fn().mockReturnValue(chain)
  return { mockSelect, chain }
}

/**
 * Build a thenable chain for `supabase.from().select().order().eq().is()` etc.
 * The list route now applies a `deleted_at IS NULL` filter via `.is()` and an
 * optional `.not()` for the archived view, so the chain mock supports those.
 */
function mockListChain(result: { data: unknown; error: unknown }) {
  const chainable: Record<string, unknown> = {
    eq: vi.fn().mockReturnThis(),
    is: vi.fn().mockReturnThis(),
    not: vi.fn().mockReturnThis(),
  }
  // Make chainable thenable so `await query` resolves
  chainable.then = (resolve: (value: { data: unknown; error: unknown }) => unknown) => Promise.resolve(result).then(resolve)
  const mockOrder = vi.fn().mockReturnValue(chainable)
  const mockSelect = vi.fn().mockReturnValue({ order: mockOrder })
  return { mockSelect, mockOrder, chainable }
}

/**
 * Build a chain for the soft-delete UPDATE used by `DELETE /v1/characters/:id`:
 * `supabase.from("characters").update({ deleted_at: ... }).eq().eq()`.
 */
function mockSoftDeleteChain(result: { data?: unknown; error: unknown }) {
  const eq2 = vi.fn().mockResolvedValue(result)
  const eq1 = vi.fn().mockReturnValue({ eq: eq2 })
  const mockUpdate = vi.fn().mockReturnValue({ eq: eq1 })
  return { mockUpdate, eq1, eq2 }
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
    await characterRoutes(instance)
  })
  await app.ready()
})

afterEach(async () => {
  await app.close()
})

// ---------------------------------------------------------------------------
// GET /v1/characters
// ---------------------------------------------------------------------------

describe("GET /v1/characters", () => {
  it("returns 200 with empty list", async () => {
    const { mockSelect } = mockListChain({ data: [], error: null })
    vi.mocked(supabase.from).mockReturnValue({ select: mockSelect } as never)

    const res = await app.inject({ method: "GET", url: "/v1/characters" })

    expect(res.statusCode).toBe(200)
    expect(res.json().characters).toEqual([])
  })

  it("returns 200 with camelCase-transformed data", async () => {
    const { mockSelect } = mockListChain({ data: [DB_CHARACTER], error: null })
    vi.mocked(supabase.from).mockReturnValue({ select: mockSelect } as never)

    const res = await app.inject({ method: "GET", url: "/v1/characters" })

    expect(res.statusCode).toBe(200)
    expect(res.json().characters).toEqual([CAMEL_CHARACTER])
  })

  it("returns 200 filtered by projectId query param", async () => {
    const { mockSelect, chainable } = mockListChain({ data: [], error: null })
    vi.mocked(supabase.from).mockReturnValue({ select: mockSelect } as never)

    const res = await app.inject({
      method: "GET",
      url: `/v1/characters?projectId=${TEST_PROJECT_ID}`,
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

    const res = await app.inject({ method: "GET", url: "/v1/characters" })

    expect(res.statusCode).toBe(500)
    expect(res.json().error.code).toBe("internal_error")
  })
})

// ---------------------------------------------------------------------------
// GET /v1/characters/:id
// ---------------------------------------------------------------------------

describe("GET /v1/characters/:id", () => {
  function getByIdChain(result: { data: unknown; error: unknown }) {
    const mockSingle = vi.fn().mockResolvedValue(result)
    const chain: Record<string, unknown> = {
      eq: vi.fn().mockReturnThis(),
      single: mockSingle,
    }
    const mockSelect = vi.fn().mockReturnValue(chain)
    return { mockSelect, chain, mockSingle }
  }

  it("returns 401 when unauthenticated", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v1/characters/${TEST_CHARACTER_ID}`,
    })
    expect(res.statusCode).toBe(401)
    expect(res.json().error.code).toBe("unauthorized")
  })

  it("returns 200 with camelCase data and scopes by user_id", async () => {
    // The handler issues two queries — characters row, then jobs pending. Mock
    // by table name so we route each `.from()` call to its own chain.
    const charsByIdChain = getByIdChain({ data: DB_CHARACTER, error: null })
    const jobsPendingChain = mockJobsPendingChain({ data: [], error: null })
    vi.mocked(supabase.from).mockImplementation((table: string) => {
      if (table === "jobs") return { select: jobsPendingChain.mockSelect } as never
      return { select: charsByIdChain.mockSelect } as never
    })

    const res = await app.inject({
      method: "GET",
      url: `/v1/characters/${TEST_CHARACTER_ID}`,
      headers: { "x-user-id": TEST_USER_ID },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual(CAMEL_CHARACTER_WITH_PENDING)
    expect(charsByIdChain.chain.eq).toHaveBeenCalledWith("id", TEST_CHARACTER_ID)
    expect(charsByIdChain.chain.eq).toHaveBeenCalledWith("user_id", TEST_USER_ID)
    // Pending-jobs query scopes by user + status + character id.
    expect(jobsPendingChain.chain.eq).toHaveBeenCalledWith("user_id", TEST_USER_ID)
    expect(jobsPendingChain.chain.in).toHaveBeenCalledWith("status", ["pending", "running"])
    expect(jobsPendingChain.chain.filter).toHaveBeenCalledWith(
      "input_data->>attachToCharacterId",
      "eq",
      TEST_CHARACTER_ID,
    )
  })

  it("maps in-flight jobs to assetType buckets for spinner rehydration", async () => {
    const charsByIdChain = getByIdChain({ data: DB_CHARACTER, error: null })
    const jobsPendingChain = mockJobsPendingChain({
      data: [
        // Asset job, expressions column — should surface as assetType:"expressions"
        {
          id: "job-1",
          input_data: {
            type: "generate-character-asset",
            attachToCharacterId: TEST_CHARACTER_ID,
            attachToColumn: "expressions",
            attachName: "smile",
          },
        },
        // lighting_variations column → assetType:"lighting" (frontend name)
        {
          id: "job-2",
          input_data: {
            type: "generate-character-asset",
            attachToCharacterId: TEST_CHARACTER_ID,
            attachToColumn: "lighting_variations",
            attachName: "dramatic",
          },
        },
        // Motion job → assetType:"motions"
        {
          id: "job-3",
          input_data: {
            type: "generate-character-motion",
            attachToCharacterId: TEST_CHARACTER_ID,
            attachName: "walking",
          },
        },
        // Portrait → not surfaced (Appearance tab has its own poll)
        {
          id: "job-4",
          input_data: {
            type: "generate-character",
            attachToCharacterId: TEST_CHARACTER_ID,
            attachName: "portrait",
          },
        },
        // Missing attachName → skipped
        { id: "job-5", input_data: { type: "generate-character-asset", attachToCharacterId: TEST_CHARACTER_ID, attachToColumn: "poses" } },
      ],
      error: null,
    })
    vi.mocked(supabase.from).mockImplementation((table: string) => {
      if (table === "jobs") return { select: jobsPendingChain.mockSelect } as never
      return { select: charsByIdChain.mockSelect } as never
    })

    const res = await app.inject({
      method: "GET",
      url: `/v1/characters/${TEST_CHARACTER_ID}`,
      headers: { "x-user-id": TEST_USER_ID },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json().pendingJobs).toEqual([
      { jobId: "job-1", assetType: "expressions", name: "smile" },
      { jobId: "job-2", assetType: "lighting", name: "dramatic" },
      { jobId: "job-3", assetType: "motions", name: "walking" },
    ])
  })

  it("returns 404 on PGRST116 (not found OR not owned)", async () => {
    // PGRST116 is returned both when the row doesn't exist and when the
    // user_id scope excludes it — the two cases must be indistinguishable.
    const { mockSelect } = getByIdChain({
      data: null,
      error: { code: "PGRST116", message: "not found" },
    })
    vi.mocked(supabase.from).mockReturnValue({ select: mockSelect } as never)

    const res = await app.inject({
      method: "GET",
      url: `/v1/characters/${TEST_CHARACTER_ID}`,
      headers: { "x-user-id": TEST_USER_ID },
    })

    expect(res.statusCode).toBe(404)
    expect(res.json().error.code).toBe("not_found")
  })

  it("returns 500 on DB error", async () => {
    const { mockSelect } = getByIdChain({
      data: null,
      error: { code: "OTHER", message: "DB error" },
    })
    vi.mocked(supabase.from).mockReturnValue({ select: mockSelect } as never)

    const res = await app.inject({
      method: "GET",
      url: `/v1/characters/${TEST_CHARACTER_ID}`,
      headers: { "x-user-id": TEST_USER_ID },
    })

    expect(res.statusCode).toBe(500)
    expect(res.json().error.code).toBe("internal_error")
  })
})

// ---------------------------------------------------------------------------
// POST /v1/characters (upsert)
// ---------------------------------------------------------------------------

describe("POST /v1/characters", () => {
  it("returns 400 when name is missing", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/characters",
      payload: { nodeId: "node-1", userId: TEST_USER_ID },
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("validation_error")
  })

  it("returns 400 when nodeId is missing", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/characters",
      payload: { name: "Hero", userId: TEST_USER_ID },
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("validation_error")
  })

  it("returns 401 when userId is missing", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/characters",
      payload: { name: "Hero", nodeId: "node-1" },
    })
    expect(res.statusCode).toBe(401)
    expect(res.json().error.code).toBe("unauthorized")
  })

  it("returns 200 on insert (no id in body)", async () => {
    const mockSingle = vi.fn().mockResolvedValue({ data: { id: TEST_CHARACTER_ID }, error: null })
    const mockSelect = vi.fn().mockReturnValue({ single: mockSingle })
    const mockInsert = vi.fn().mockReturnValue({ select: mockSelect })
    vi.mocked(supabase.from).mockReturnValue({ insert: mockInsert } as never)

    const res = await app.inject({
      method: "POST",
      url: "/v1/characters",
      payload: { name: "Hero", nodeId: "node-1", userId: TEST_USER_ID },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json().id).toBe(TEST_CHARACTER_ID)
    expect(mockInsert).toHaveBeenCalledWith(
      expect.objectContaining({ name: "Hero", node_id: "node-1", user_id: TEST_USER_ID }),
    )
  })

  it("returns 200 on update (id in body) and scopes by user_id", async () => {
    const mockSingle = vi.fn().mockResolvedValue({ data: { id: TEST_CHARACTER_ID }, error: null })
    const mockSelect = vi.fn().mockReturnValue({ single: mockSingle })
    const chain: Record<string, unknown> = {
      eq: vi.fn().mockReturnThis(),
      select: mockSelect,
    }
    const mockUpdate = vi.fn().mockReturnValue(chain)
    vi.mocked(supabase.from).mockReturnValue({ update: mockUpdate } as never)

    const res = await app.inject({
      method: "POST",
      url: "/v1/characters",
      payload: {
        id: TEST_CHARACTER_ID,
        name: "Hero Updated",
        nodeId: "node-1",
        userId: TEST_USER_ID,
      },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json().id).toBe(TEST_CHARACTER_ID)
    expect(mockUpdate).toHaveBeenCalled()
    expect(chain.eq).toHaveBeenCalledWith("id", TEST_CHARACTER_ID)
    expect(chain.eq).toHaveBeenCalledWith("user_id", TEST_USER_ID)
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
      url: "/v1/characters",
      payload: { name: "Hero", nodeId: "node-1", userId: TEST_USER_ID },
    })

    expect(res.statusCode).toBe(500)
    expect(res.json().error.code).toBe("internal_error")
  })
})

// ---------------------------------------------------------------------------
// DELETE /v1/characters/:id
// ---------------------------------------------------------------------------

// DELETE is now a SOFT delete (sets `deleted_at`), so the test asserts the
// route issues an UPDATE rather than a DELETE, and the response payload
// carries `archived: true` for callers that want to distinguish.
describe("DELETE /v1/characters/:id (soft delete)", () => {
  it("returns 401 when unauthenticated", async () => {
    const res = await app.inject({
      method: "DELETE",
      url: `/v1/characters/${TEST_CHARACTER_ID}`,
    })
    expect(res.statusCode).toBe(401)
    expect(res.json().error.code).toBe("unauthorized")
  })

  it("returns 200 on success and scopes by user_id; sets deleted_at via UPDATE", async () => {
    const { mockUpdate, eq1, eq2 } = mockSoftDeleteChain({ error: null })
    vi.mocked(supabase.from).mockReturnValue({ update: mockUpdate } as never)

    const res = await app.inject({
      method: "DELETE",
      url: `/v1/characters/${TEST_CHARACTER_ID}`,
      headers: { "x-user-id": TEST_USER_ID },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ success: true, archived: true })
    // Verify the update payload sets deleted_at (don't pin to exact timestamp).
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ deleted_at: expect.any(String), updated_at: expect.any(String) }),
    )
    expect(eq1).toHaveBeenCalledWith("id", TEST_CHARACTER_ID)
    expect(eq2).toHaveBeenCalledWith("user_id", TEST_USER_ID)
  })

  it("returns 500 on DB error", async () => {
    const { mockUpdate } = mockSoftDeleteChain({ error: { message: "constraint violation" } })
    vi.mocked(supabase.from).mockReturnValue({ update: mockUpdate } as never)

    const res = await app.inject({
      method: "DELETE",
      url: `/v1/characters/${TEST_CHARACTER_ID}`,
      headers: { "x-user-id": TEST_USER_ID },
    })

    expect(res.statusCode).toBe(500)
    expect(res.json().error.code).toBe("internal_error")
  })
})
