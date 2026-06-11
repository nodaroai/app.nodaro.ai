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
    // Used by the permanent-delete path's inline `r2KeyFromPublicUrl` helper
    // to distinguish R2-hosted URLs (extracted as keys for batchDeleteFromR2)
    // from external CDN URLs (passed through to DB delete only).
    R2_PUBLIC_URL: "https://r2.example.com",
    R2_BUCKET_NAME: "test-bucket",
  },
  isCloud: () => true,
  hasCredits: () => true,
  isCommunity: () => false,
  isBusiness: () => false,
  hasAdmin: () => true,
}))

// Stub the storage helpers so the permanent-delete tests don't try to talk to
// S3. `batchDeleteFromR2` returns the empty-success shape callers expect.
vi.mock("@/lib/storage.js", () => ({
  batchDeleteFromR2: vi.fn().mockResolvedValue({ deleted: 0, errors: 0 }),
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
import { batchDeleteFromR2 } from "../../lib/storage.js"

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
  lighting: [],
  seasons: [],
  atmosphere_motions: [],
  reference_photos: [],
  canonical_description: null,
  style_lock: true,
  deleted_at: null,
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
  lighting: [],
  seasons: [],
  atmosphereMotions: [],
  boards: [],
  referencePhotos: [],
  canonicalDescription: "", // coerced from null
  styleLock: true,
  selectedAssetByVariant: {},
  sheets: [],
  detailCloseups: [],
  deletedAt: null,
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
}

function mockListChain(result: { data: unknown; error: unknown }) {
  const chainable: Record<string, unknown> = {
    eq: vi.fn().mockReturnThis(),
    is: vi.fn().mockReturnThis(),
    not: vi.fn().mockReturnThis(),
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
  function getByIdChain(result: { data: unknown; error: unknown }) {
    const mockSingle = vi.fn().mockResolvedValue(result)
    const chain: Record<string, unknown> = {
      eq: vi.fn().mockReturnThis(),
      single: mockSingle,
    }
    const mockSelect = vi.fn().mockReturnValue(chain)
    return { mockSelect, chain, mockSingle }
  }

  // Second .from() call in the success path: jobs query for pendingJobs.
  function jobsChain(jobsResult: { data: unknown; error: unknown } = { data: [], error: null }) {
    const chain: Record<string, unknown> = {
      eq: vi.fn().mockReturnThis(),
      in: vi.fn().mockReturnThis(),
      filter: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue(jobsResult),
    }
    const mockSelect = vi.fn().mockReturnValue(chain)
    return { mockSelect, chain }
  }

  it("returns 401 when unauthenticated", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v1/locations/${TEST_LOCATION_ID}`,
    })
    expect(res.statusCode).toBe(401)
    expect(res.json().error.code).toBe("unauthorized")
  })

  it("returns 200 with camelCase data and scopes by user_id", async () => {
    const { mockSelect: locSelect, chain: locChain } = getByIdChain({ data: DB_LOCATION, error: null })
    const { mockSelect: jobsSelect } = jobsChain()
    vi.mocked(supabase.from)
      .mockReturnValueOnce({ select: locSelect } as never)
      .mockReturnValueOnce({ select: jobsSelect } as never)

    const res = await app.inject({
      method: "GET",
      url: `/v1/locations/${TEST_LOCATION_ID}`,
      headers: { "x-user-id": TEST_USER_ID },
    })

    expect(res.statusCode).toBe(200)
    // GET /:id now also returns pendingJobs alongside the row.
    expect(res.json()).toEqual({ ...CAMEL_LOCATION, pendingJobs: [] })
    expect(locChain.eq).toHaveBeenCalledWith("id", TEST_LOCATION_ID)
    expect(locChain.eq).toHaveBeenCalledWith("user_id", TEST_USER_ID)
  })

  it("returns selected_asset_by_variant on the row (read round-trip)", async () => {
    const rowWithSelection = {
      ...DB_LOCATION,
      selected_asset_by_variant: { "timeOfDay:Dawn": "https://example.com/dawn.png" },
    }
    const { mockSelect: locSelect } = getByIdChain({ data: rowWithSelection, error: null })
    const { mockSelect: jobsSelect } = jobsChain()
    vi.mocked(supabase.from)
      .mockReturnValueOnce({ select: locSelect } as never)
      .mockReturnValueOnce({ select: jobsSelect } as never)

    const res = await app.inject({
      method: "GET",
      url: `/v1/locations/${TEST_LOCATION_ID}`,
      headers: { "x-user-id": TEST_USER_ID },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json().selectedAssetByVariant).toEqual({ "timeOfDay:Dawn": "https://example.com/dawn.png" })
  })

  it("returns 404 on PGRST116 (not found OR not owned)", async () => {
    const { mockSelect: locSelect } = getByIdChain({
      data: null,
      error: { code: "PGRST116", message: "not found" },
    })
    // GET /:id parallelizes the location + jobs queries via Promise.all, so
    // both .from() calls fire even on the not-found path. Mock both chains.
    const { mockSelect: jobsSelect } = jobsChain()
    vi.mocked(supabase.from)
      .mockReturnValueOnce({ select: locSelect } as never)
      .mockReturnValueOnce({ select: jobsSelect } as never)

    const res = await app.inject({
      method: "GET",
      url: `/v1/locations/${TEST_LOCATION_ID}`,
      headers: { "x-user-id": TEST_USER_ID },
    })

    expect(res.statusCode).toBe(404)
    expect(res.json().error.code).toBe("not_found")
  })

  it("returns 500 on DB error", async () => {
    const { mockSelect: locSelect } = getByIdChain({
      data: null,
      error: { code: "OTHER", message: "DB error" },
    })
    const { mockSelect: jobsSelect } = jobsChain()
    vi.mocked(supabase.from)
      .mockReturnValueOnce({ select: locSelect } as never)
      .mockReturnValueOnce({ select: jobsSelect } as never)

    const res = await app.inject({
      method: "GET",
      url: `/v1/locations/${TEST_LOCATION_ID}`,
      headers: { "x-user-id": TEST_USER_ID },
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

  it("persists a valid image_provider on insert", async () => {
    const mockSingle = vi.fn().mockResolvedValue({ data: { id: TEST_LOCATION_ID }, error: null })
    const mockSelect = vi.fn().mockReturnValue({ single: mockSingle })
    const mockInsert = vi.fn().mockReturnValue({ select: mockSelect })
    vi.mocked(supabase.from).mockReturnValue({ insert: mockInsert } as never)

    const res = await app.inject({
      method: "POST",
      url: "/v1/locations",
      payload: { name: "Forest", nodeId: "node-2", userId: TEST_USER_ID, imageProvider: "nano-banana" },
    })
    expect(res.statusCode).toBe(200)
    expect(mockInsert).toHaveBeenCalledWith(expect.objectContaining({ image_provider: "nano-banana" }))
  })

  it("nulls an unknown image_provider on insert", async () => {
    const mockSingle = vi.fn().mockResolvedValue({ data: { id: TEST_LOCATION_ID }, error: null })
    const mockSelect = vi.fn().mockReturnValue({ single: mockSingle })
    const mockInsert = vi.fn().mockReturnValue({ select: mockSelect })
    vi.mocked(supabase.from).mockReturnValue({ insert: mockInsert } as never)

    const res = await app.inject({
      method: "POST",
      url: "/v1/locations",
      payload: { name: "Forest", nodeId: "node-2", userId: TEST_USER_ID, imageProvider: "not-a-model" },
    })
    expect(res.statusCode).toBe(200)
    expect(mockInsert).toHaveBeenCalledWith(expect.objectContaining({ image_provider: null }))
  })

  // selected_asset_by_variant (migration 205): OPAQUE per-variant "chosen take"
  // map. Keys stored VERBATIM (no normalization); soft-capped with overflow
  // dropped silently. Mirrors the characters wiring via the shared
  // capSelectedAssetByVariant helper.
  it("persists selected_asset_by_variant VERBATIM on insert", async () => {
    const mockSingle = vi.fn().mockResolvedValue({ data: { id: TEST_LOCATION_ID }, error: null })
    const mockSelect = vi.fn().mockReturnValue({ single: mockSingle })
    const mockInsert = vi.fn().mockReturnValue({ select: mockSelect })
    vi.mocked(supabase.from).mockReturnValue({ insert: mockInsert } as never)

    const res = await app.inject({
      method: "POST",
      url: "/v1/locations",
      payload: {
        name: "Forest",
        nodeId: "node-2",
        userId: TEST_USER_ID,
        selectedAssetByVariant: { "timeOfDay:Golden Hour": "https://example.com/golden.png" },
      },
    })
    expect(res.statusCode).toBe(200)
    expect(mockInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        selected_asset_by_variant: { "timeOfDay:Golden Hour": "https://example.com/golden.png" },
      }),
    )
  })

  it("soft-caps selected_asset_by_variant to 200 keys on insert (truncates, NOT a 400)", async () => {
    const captured: { row: Record<string, unknown> | null } = { row: null }
    const mockSingle = vi.fn().mockResolvedValue({ data: { id: TEST_LOCATION_ID }, error: null })
    const mockSelect = vi.fn().mockReturnValue({ single: mockSingle })
    const mockInsert = vi.fn((row: Record<string, unknown>) => {
      captured.row = row
      return { select: mockSelect }
    })
    vi.mocked(supabase.from).mockReturnValue({ insert: mockInsert } as never)

    const oversized: Record<string, string> = {}
    for (let i = 0; i < 250; i++) oversized[`timeOfDay:v${i}`] = `https://example.com/${i}.png`

    const res = await app.inject({
      method: "POST",
      url: "/v1/locations",
      payload: { name: "Forest", nodeId: "node-2", userId: TEST_USER_ID, selectedAssetByVariant: oversized },
    })
    expect(res.statusCode).toBe(200)
    expect(Object.keys(captured.row?.selected_asset_by_variant as Record<string, string>)).toHaveLength(200)
  })

  it("update persists selected_asset_by_variant without dragging in worker-owned buckets", async () => {
    const captured: { patch: Record<string, unknown> | null } = { patch: null }
    const mockSingle = vi.fn().mockResolvedValue({ data: { id: TEST_LOCATION_ID, updated_at: "2026-01-02T00:00:00Z" }, error: null })
    const mockSelect = vi.fn().mockReturnValue({ single: mockSingle })
    const chain: Record<string, unknown> = { eq: vi.fn().mockReturnThis(), select: mockSelect }
    const mockUpdate = vi.fn((patch: Record<string, unknown>) => {
      captured.patch = patch
      return chain
    })
    vi.mocked(supabase.from).mockReturnValue({ update: mockUpdate } as never)

    const res = await app.inject({
      method: "POST",
      url: "/v1/locations",
      payload: {
        id: TEST_LOCATION_ID,
        name: "Forest",
        nodeId: "node-2",
        userId: TEST_USER_ID,
        selectedAssetByVariant: { "weather:Rain": "https://example.com/rain.png" },
      },
    })
    expect(res.statusCode).toBe(200)
    expect(captured.patch?.selected_asset_by_variant).toEqual({ "weather:Rain": "https://example.com/rain.png" })
    for (const col of ["time_of_day", "weather", "angles", "lighting", "seasons", "atmosphere_motions"]) {
      expect(captured.patch).not.toHaveProperty(col)
    }
  })

  it("returns 200 on update (id in body) and scopes by user_id", async () => {
    const mockSingle = vi.fn().mockResolvedValue({ data: { id: TEST_LOCATION_ID }, error: null })
    const mockSelect = vi.fn().mockReturnValue({ single: mockSingle })
    const chain: Record<string, unknown> = {
      eq: vi.fn().mockReturnThis(),
      select: mockSelect,
    }
    const mockUpdate = vi.fn().mockReturnValue(chain)
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
    expect(chain.eq).toHaveBeenCalledWith("id", TEST_LOCATION_ID)
    expect(chain.eq).toHaveBeenCalledWith("user_id", TEST_USER_ID)
  })

  it("UPDATE accepts a partial body without name/nodeId (boards-only write)", async () => {
    // Regression — the schema used to REQUIRE name + nodeId on every request,
    // 400ing the studio's partial writes ({id, boards} for Location Boards,
    // {id, imageProvider} for the model pick) even though the update branch
    // writes both conditionally.
    const mockSingle = vi.fn().mockResolvedValue({
      data: { id: TEST_LOCATION_ID, updated_at: "2026-06-11T00:00:00Z" },
      error: null,
    })
    const mockSelect = vi.fn().mockReturnValue({ single: mockSingle })
    const chain: Record<string, unknown> = { eq: vi.fn().mockReturnThis(), select: mockSelect }
    const mockUpdate = vi.fn().mockReturnValue(chain)
    vi.mocked(supabase.from).mockReturnValue({ update: mockUpdate } as never)

    const res = await app.inject({
      method: "POST",
      url: "/v1/locations",
      payload: {
        id: TEST_LOCATION_ID,
        userId: TEST_USER_ID,
        boards: [{ name: "Winter", url: "https://cdn.example/winter.png" }],
      },
    })

    expect(res.statusCode).toBe(200)
    const patch = mockUpdate.mock.calls[0][0] as Record<string, unknown>
    expect(patch.boards).toEqual([{ name: "Winter", url: "https://cdn.example/winter.png" }])
    expect("name" in patch).toBe(false)
    expect("node_id" in patch).toBe(false)
  })

  it("INSERT still requires name + nodeId (enforced in the handler)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/locations",
      payload: { userId: TEST_USER_ID, name: "Forest" },
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("validation_error")
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

describe("DELETE /v1/locations/:id (soft-delete)", () => {
  function softDeleteChain(result: { error: unknown }) {
    const chain: Record<string, unknown> = {
      eq: vi.fn().mockReturnThis(),
      is: vi.fn().mockReturnThis(),
      then: (resolve: (value: { error: unknown }) => unknown) =>
        Promise.resolve(result).then(resolve),
    }
    const mockUpdate = vi.fn().mockReturnValue(chain)
    return { mockUpdate, chain }
  }

  it("returns 401 when unauthenticated", async () => {
    const res = await app.inject({
      method: "DELETE",
      url: `/v1/locations/${TEST_LOCATION_ID}`,
    })
    expect(res.statusCode).toBe(401)
    expect(res.json().error.code).toBe("unauthorized")
  })

  it("returns 200 on success, scopes by user_id, returns archived: true", async () => {
    const { mockUpdate, chain } = softDeleteChain({ error: null })
    vi.mocked(supabase.from).mockReturnValue({ update: mockUpdate } as never)

    const res = await app.inject({
      method: "DELETE",
      url: `/v1/locations/${TEST_LOCATION_ID}`,
      headers: { "x-user-id": TEST_USER_ID },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ success: true, archived: true })
    expect(chain.eq).toHaveBeenCalledWith("id", TEST_LOCATION_ID)
    expect(chain.eq).toHaveBeenCalledWith("user_id", TEST_USER_ID)
    // Only active rows can be archived — second archive is a no-op.
    expect(chain.is).toHaveBeenCalledWith("deleted_at", null)
  })

  it("returns 500 with delete_failed on DB error", async () => {
    const { mockUpdate } = softDeleteChain({ error: { message: "FK constraint" } })
    vi.mocked(supabase.from).mockReturnValue({ update: mockUpdate } as never)

    const res = await app.inject({
      method: "DELETE",
      url: `/v1/locations/${TEST_LOCATION_ID}`,
      headers: { "x-user-id": TEST_USER_ID },
    })

    expect(res.statusCode).toBe(500)
    expect(res.json().error.code).toBe("delete_failed")
  })

  // ?permanent=false (or any non-"true" value) falls through to the soft-delete
  // branch — guards against a future Zod tightening accidentally toggling the
  // default behavior.
  it("?permanent=false routes through the soft-delete branch", async () => {
    const { mockUpdate, chain } = softDeleteChain({ error: null })
    vi.mocked(supabase.from).mockReturnValue({ update: mockUpdate } as never)

    const res = await app.inject({
      method: "DELETE",
      url: `/v1/locations/${TEST_LOCATION_ID}?permanent=false`,
      headers: { "x-user-id": TEST_USER_ID },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ success: true, archived: true })
    // The .is("deleted_at", null) predicate is the soft-delete fingerprint —
    // the permanent path does NOT call .is(), it calls .delete().
    expect(chain.is).toHaveBeenCalledWith("deleted_at", null)
    expect(batchDeleteFromR2).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// DELETE /v1/locations/:id?permanent=true (hard-delete + R2 cleanup)
// ---------------------------------------------------------------------------

describe("DELETE /v1/locations/:id?permanent=true", () => {
  // Chain builder for the permanent-delete handler's call sequence:
  //   1. SELECT(id, deleted_at, <asset cols>) → maybeSingle() — ownership + archive check + R2 keys
  //   2. DELETE                               → eq().eq() (terminal await) — hard-delete the row
  function ownershipChain(result: { data: unknown; error: unknown }) {
    const chain: Record<string, unknown> = {
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue(result),
    }
    const mockSelect = vi.fn().mockReturnValue(chain)
    return { mockSelect, chain }
  }
  function hardDeleteChain(result: { error: unknown }) {
    const chain: Record<string, unknown> = {
      eq: vi.fn().mockReturnThis(),
      then: (resolve: (value: { error: unknown }) => unknown) =>
        Promise.resolve(result).then(resolve),
    }
    const mockDelete = vi.fn().mockReturnValue(chain)
    return { mockDelete, chain }
  }

  it("returns 401 when unauthenticated", async () => {
    const res = await app.inject({
      method: "DELETE",
      url: `/v1/locations/${TEST_LOCATION_ID}?permanent=true`,
    })
    expect(res.statusCode).toBe(401)
    expect(res.json().error.code).toBe("unauthorized")
  })

  it("returns 404 when the row doesn't exist or is owned by another user", async () => {
    // The ownership SELECT returns no row — the handler short-circuits before
    // any R2 collection or DB delete fires.
    const { mockSelect: ownerSelect } = ownershipChain({ data: null, error: null })
    vi.mocked(supabase.from).mockReturnValueOnce({ select: ownerSelect } as never)

    const res = await app.inject({
      method: "DELETE",
      url: `/v1/locations/${TEST_LOCATION_ID}?permanent=true`,
      headers: { "x-user-id": TEST_USER_ID },
    })

    expect(res.statusCode).toBe(404)
    expect(res.json().error.code).toBe("not_found")
    expect(batchDeleteFromR2).not.toHaveBeenCalled()
  })

  it("returns 400 not_archived when the row is still active (archive-first policy)", async () => {
    // Row exists + owned but `deleted_at` is null → must archive first.
    const { mockSelect: ownerSelect } = ownershipChain({
      data: { id: TEST_LOCATION_ID, deleted_at: null },
      error: null,
    })
    vi.mocked(supabase.from).mockReturnValueOnce({ select: ownerSelect } as never)

    const res = await app.inject({
      method: "DELETE",
      url: `/v1/locations/${TEST_LOCATION_ID}?permanent=true`,
      headers: { "x-user-id": TEST_USER_ID },
    })

    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("not_archived")
    expect(batchDeleteFromR2).not.toHaveBeenCalled()
  })

  it("hard-deletes an archived row + batch-deletes only R2-hosted asset keys", async () => {
    // Archived row + a mix of R2-hosted and external CDN URLs across every
    // JSONB column we scan. The handler must extract keys for the R2 URLs
    // and skip the external ones (no spurious R2 deletes).
    const ASSET_ROW = {
      source_image_url: "https://r2.example.com/locations/forest/main.png",
      time_of_day: [{ name: "noon", url: "https://r2.example.com/locations/forest/noon.png" }],
      weather: [{ name: "rain", url: "https://cdn.external.com/rain.png" }], // external — skipped
      seasons: [{ name: "winter", url: "https://r2.example.com/locations/forest/winter.png" }],
      angles: null, // empty bucket — must not crash
      lighting: [],
      atmosphere_motions: [
        { name: "fog", url: "https://r2.example.com/locations/forest/fog.mp4" },
      ],
      reference_photos: [
        { kind: "wide", url: "https://r2.example.com/locations/forest/ref1.jpg" },
        { kind: "detail", url: "https://cdn.external.com/ref2.jpg" }, // external — skipped
      ],
    }

    const { mockSelect: ownerSelect } = ownershipChain({
      data: { id: TEST_LOCATION_ID, deleted_at: "2026-05-01T00:00:00Z", ...ASSET_ROW },
      error: null,
    })
    const { mockDelete, chain: deleteChain } = hardDeleteChain({ error: null })

    vi.mocked(supabase.from)
      .mockReturnValueOnce({ select: ownerSelect } as never) // ownership + R2 keys
      .mockReturnValueOnce({ delete: mockDelete } as never) // hard-delete

    const res = await app.inject({
      method: "DELETE",
      url: `/v1/locations/${TEST_LOCATION_ID}?permanent=true`,
      headers: { "x-user-id": TEST_USER_ID },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ success: true, permanent: true })

    // 5 R2-hosted URLs across source_image_url + time_of_day + seasons +
    // atmosphere_motions + reference_photos. The 2 external URLs are skipped.
    expect(batchDeleteFromR2).toHaveBeenCalledTimes(1)
    const keysArg = vi.mocked(batchDeleteFromR2).mock.calls[0]?.[0] ?? []
    expect(keysArg).toEqual([
      "locations/forest/main.png",
      "locations/forest/noon.png",
      "locations/forest/winter.png",
      "locations/forest/fog.mp4",
      "locations/forest/ref1.jpg",
    ])

    // Hard-delete must be scoped by both id AND user_id — defense in depth
    // against the ownership check above being somehow bypassed.
    expect(mockDelete).toHaveBeenCalled()
    expect(deleteChain.eq).toHaveBeenCalledWith("id", TEST_LOCATION_ID)
    expect(deleteChain.eq).toHaveBeenCalledWith("user_id", TEST_USER_ID)
  })

  it("skips batch-delete when the row has no R2-hosted assets", async () => {
    // All-empty asset row → no keys collected → batchDeleteFromR2 not called.
    // Guards against an extra round trip for archived rows with no assets.
    const EMPTY_ASSETS = {
      source_image_url: null,
      time_of_day: [],
      weather: [],
      seasons: [],
      angles: [],
      lighting: [],
      atmosphere_motions: [],
      reference_photos: [],
    }
    const { mockSelect: ownerSelect } = ownershipChain({
      data: { id: TEST_LOCATION_ID, deleted_at: "2026-05-01T00:00:00Z", ...EMPTY_ASSETS },
      error: null,
    })
    const { mockDelete } = hardDeleteChain({ error: null })

    vi.mocked(supabase.from)
      .mockReturnValueOnce({ select: ownerSelect } as never)
      .mockReturnValueOnce({ delete: mockDelete } as never)

    const res = await app.inject({
      method: "DELETE",
      url: `/v1/locations/${TEST_LOCATION_ID}?permanent=true`,
      headers: { "x-user-id": TEST_USER_ID },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ success: true, permanent: true })
    expect(batchDeleteFromR2).not.toHaveBeenCalled()
    expect(mockDelete).toHaveBeenCalled()
  })

  it("returns 500 delete_failed when the hard-delete DB call errors", async () => {
    const EMPTY_ASSETS = {
      source_image_url: null,
      time_of_day: [],
      weather: [],
      seasons: [],
      angles: [],
      lighting: [],
      atmosphere_motions: [],
      reference_photos: [],
    }
    const { mockSelect: ownerSelect } = ownershipChain({
      data: { id: TEST_LOCATION_ID, deleted_at: "2026-05-01T00:00:00Z", ...EMPTY_ASSETS },
      error: null,
    })
    const { mockDelete } = hardDeleteChain({ error: { message: "FK violation" } })

    vi.mocked(supabase.from)
      .mockReturnValueOnce({ select: ownerSelect } as never)
      .mockReturnValueOnce({ delete: mockDelete } as never)

    const res = await app.inject({
      method: "DELETE",
      url: `/v1/locations/${TEST_LOCATION_ID}?permanent=true`,
      headers: { "x-user-id": TEST_USER_ID },
    })

    expect(res.statusCode).toBe(500)
    expect(res.json().error.code).toBe("delete_failed")
  })

  it("returns 400 validation_error on bogus query value", async () => {
    const res = await app.inject({
      method: "DELETE",
      url: `/v1/locations/${TEST_LOCATION_ID}?permanent=banana`,
      headers: { "x-user-id": TEST_USER_ID },
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("validation_error")
  })
})
