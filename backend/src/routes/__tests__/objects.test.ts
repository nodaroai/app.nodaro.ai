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

import { objectRoutes } from "../objects.js"
import { supabase } from "../../lib/supabase.js"
import { batchDeleteFromR2 } from "../../lib/storage.js"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TEST_USER_ID = "00000000-0000-4000-8000-000000000001"
const TEST_PROJECT_ID = "00000000-0000-4000-8000-000000000010"
const TEST_OBJECT_ID = "00000000-0000-4000-8000-000000000040"

const DB_OBJECT = {
  id: TEST_OBJECT_ID,
  user_id: TEST_USER_ID,
  node_id: "node-3",
  project_id: TEST_PROJECT_ID,
  name: "Sword",
  description: "A magical sword",
  category: "weapon",
  style: "fantasy",
  source_image_url: "https://example.com/sword.png",
  angles: [],
  materials: [],
  variations: [],
  motion_clips: [],
  reference_photos: [],
  canonical_description: null,
  style_lock: true,
  deleted_at: null,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
}

const CAMEL_OBJECT = {
  id: TEST_OBJECT_ID,
  userId: TEST_USER_ID,
  nodeId: "node-3",
  projectId: TEST_PROJECT_ID,
  name: "Sword",
  description: "A magical sword",
  category: "weapon",
  style: "fantasy",
  sourceImageUrl: "https://example.com/sword.png",
  angles: [],
  materials: [],
  variations: [],
  motionClips: [],
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
    await objectRoutes(instance)
  })
  await app.ready()
})

afterEach(async () => {
  await app.close()
})

// ---------------------------------------------------------------------------
// GET /v1/objects
// ---------------------------------------------------------------------------

describe("GET /v1/objects", () => {
  it("returns 200 with empty list", async () => {
    const { mockSelect } = mockListChain({ data: [], error: null })
    vi.mocked(supabase.from).mockReturnValue({ select: mockSelect } as never)

    const res = await app.inject({ method: "GET", url: "/v1/objects" })

    expect(res.statusCode).toBe(200)
    expect(res.json().objects).toEqual([])
  })

  it("returns 200 with camelCase-transformed data incl. 5 new columns", async () => {
    const { mockSelect } = mockListChain({ data: [DB_OBJECT], error: null })
    vi.mocked(supabase.from).mockReturnValue({ select: mockSelect } as never)

    const res = await app.inject({ method: "GET", url: "/v1/objects" })

    expect(res.statusCode).toBe(200)
    expect(res.json().objects).toEqual([CAMEL_OBJECT])
    // Spot-check the 5 new fields explicitly so a future regression that drops
    // one fails this test rather than relying on the deep-equality match alone.
    const row = res.json().objects[0]
    expect(row).toHaveProperty("motionClips", [])
    expect(row).toHaveProperty("referencePhotos", [])
    expect(row).toHaveProperty("canonicalDescription", "")
    expect(row).toHaveProperty("styleLock", true)
    expect(row).toHaveProperty("deletedAt", null)
  })

  it("returns 200 filtered by projectId query param", async () => {
    const { mockSelect, chainable } = mockListChain({ data: [], error: null })
    vi.mocked(supabase.from).mockReturnValue({ select: mockSelect } as never)

    const res = await app.inject({
      method: "GET",
      url: `/v1/objects?projectId=${TEST_PROJECT_ID}`,
    })

    expect(res.statusCode).toBe(200)
    expect(chainable.eq).toHaveBeenCalledWith("project_id", TEST_PROJECT_ID)
  })

  it("default view filters by deleted_at IS NULL (hides archived)", async () => {
    const { mockSelect, chainable } = mockListChain({ data: [], error: null })
    vi.mocked(supabase.from).mockReturnValue({ select: mockSelect } as never)

    const res = await app.inject({ method: "GET", url: "/v1/objects" })

    expect(res.statusCode).toBe(200)
    expect(chainable.is).toHaveBeenCalledWith("deleted_at", null)
    expect(chainable.not).not.toHaveBeenCalled()
  })

  it("?archived=true flips filter to deleted_at IS NOT NULL", async () => {
    const { mockSelect, chainable } = mockListChain({ data: [], error: null })
    vi.mocked(supabase.from).mockReturnValue({ select: mockSelect } as never)

    const res = await app.inject({ method: "GET", url: "/v1/objects?archived=true" })

    expect(res.statusCode).toBe(200)
    expect(chainable.not).toHaveBeenCalledWith("deleted_at", "is", null)
    // The .is("deleted_at", null) default branch must NOT also fire — the two
    // are mutually exclusive.
    expect(chainable.is).not.toHaveBeenCalledWith("deleted_at", null)
  })

  it("returns 500 on DB error", async () => {
    const { mockSelect } = mockListChain({
      data: null,
      error: { message: "DB down" },
    })
    vi.mocked(supabase.from).mockReturnValue({ select: mockSelect } as never)

    const res = await app.inject({ method: "GET", url: "/v1/objects" })

    expect(res.statusCode).toBe(500)
    expect(res.json().error.code).toBe("internal_error")
  })
})

// ---------------------------------------------------------------------------
// GET /v1/objects/:id
// ---------------------------------------------------------------------------

describe("GET /v1/objects/:id", () => {
  function getByIdChain(result: { data: unknown; error: unknown }) {
    const mockSingle = vi.fn().mockResolvedValue(result)
    const chain: Record<string, unknown> = {
      eq: vi.fn().mockReturnThis(),
      is: vi.fn().mockReturnThis(),
      single: mockSingle,
    }
    const mockSelect = vi.fn().mockReturnValue(chain)
    return { mockSelect, chain, mockSingle }
  }

  it("returns 401 when unauthenticated", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v1/objects/${TEST_OBJECT_ID}`,
    })
    expect(res.statusCode).toBe(401)
    expect(res.json().error.code).toBe("unauthorized")
  })

  it("returns 200 with camelCase data and scopes by user_id + deleted_at IS NULL", async () => {
    const { mockSelect, chain } = getByIdChain({ data: DB_OBJECT, error: null })
    vi.mocked(supabase.from).mockReturnValue({ select: mockSelect } as never)

    const res = await app.inject({
      method: "GET",
      url: `/v1/objects/${TEST_OBJECT_ID}`,
      headers: { "x-user-id": TEST_USER_ID },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual(CAMEL_OBJECT)
    expect(chain.eq).toHaveBeenCalledWith("id", TEST_OBJECT_ID)
    expect(chain.eq).toHaveBeenCalledWith("user_id", TEST_USER_ID)
    // Soft-delete: default GET respects deleted_at IS NULL.
    expect(chain.is).toHaveBeenCalledWith("deleted_at", null)
  })

  it("returns selected_asset_by_variant on the row (read round-trip)", async () => {
    const rowWithSelection = {
      ...DB_OBJECT,
      selected_asset_by_variant: { "angles:Front": "https://example.com/front.png" },
    }
    const { mockSelect } = getByIdChain({ data: rowWithSelection, error: null })
    vi.mocked(supabase.from).mockReturnValue({ select: mockSelect } as never)

    const res = await app.inject({
      method: "GET",
      url: `/v1/objects/${TEST_OBJECT_ID}`,
      headers: { "x-user-id": TEST_USER_ID },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json().selectedAssetByVariant).toEqual({ "angles:Front": "https://example.com/front.png" })
  })

  it("returns 404 on PGRST116 (not found OR archived OR not owned — uniform code)", async () => {
    const { mockSelect } = getByIdChain({
      data: null,
      error: { code: "PGRST116", message: "not found" },
    })
    vi.mocked(supabase.from).mockReturnValue({ select: mockSelect } as never)

    const res = await app.inject({
      method: "GET",
      url: `/v1/objects/${TEST_OBJECT_ID}`,
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
      url: `/v1/objects/${TEST_OBJECT_ID}`,
      headers: { "x-user-id": TEST_USER_ID },
    })

    expect(res.statusCode).toBe(500)
    expect(res.json().error.code).toBe("internal_error")
  })
})

// ---------------------------------------------------------------------------
// POST /v1/objects (upsert)
// ---------------------------------------------------------------------------

describe("POST /v1/objects", () => {
  it("returns 400 when name is missing", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/objects",
      payload: { nodeId: "node-3", userId: TEST_USER_ID },
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("validation_error")
  })

  it("returns 401 when userId is missing", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/objects",
      payload: { name: "Sword", nodeId: "node-3" },
    })
    expect(res.statusCode).toBe(401)
    expect(res.json().error.code).toBe("unauthorized")
  })

  it("returns 200 on insert (no id in body)", async () => {
    const mockSingle = vi.fn().mockResolvedValue({ data: { id: TEST_OBJECT_ID }, error: null })
    const mockSelect = vi.fn().mockReturnValue({ single: mockSingle })
    const mockInsert = vi.fn().mockReturnValue({ select: mockSelect })
    vi.mocked(supabase.from).mockReturnValue({ insert: mockInsert } as never)

    const res = await app.inject({
      method: "POST",
      url: "/v1/objects",
      payload: { name: "Sword", nodeId: "node-3", userId: TEST_USER_ID },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json().id).toBe(TEST_OBJECT_ID)
    expect(mockInsert).toHaveBeenCalledWith(
      expect.objectContaining({ name: "Sword", node_id: "node-3", user_id: TEST_USER_ID }),
    )
  })

  it("persists a valid image_provider on insert", async () => {
    const mockSingle = vi.fn().mockResolvedValue({ data: { id: TEST_OBJECT_ID }, error: null })
    const mockSelect = vi.fn().mockReturnValue({ single: mockSingle })
    const mockInsert = vi.fn().mockReturnValue({ select: mockSelect })
    vi.mocked(supabase.from).mockReturnValue({ insert: mockInsert } as never)

    const res = await app.inject({
      method: "POST",
      url: "/v1/objects",
      payload: { name: "Sword", nodeId: "node-3", userId: TEST_USER_ID, imageProvider: "nano-banana" },
    })
    expect(res.statusCode).toBe(200)
    expect(mockInsert).toHaveBeenCalledWith(expect.objectContaining({ image_provider: "nano-banana" }))
  })

  it("nulls an unknown image_provider on insert", async () => {
    const mockSingle = vi.fn().mockResolvedValue({ data: { id: TEST_OBJECT_ID }, error: null })
    const mockSelect = vi.fn().mockReturnValue({ single: mockSingle })
    const mockInsert = vi.fn().mockReturnValue({ select: mockSelect })
    vi.mocked(supabase.from).mockReturnValue({ insert: mockInsert } as never)

    const res = await app.inject({
      method: "POST",
      url: "/v1/objects",
      payload: { name: "Sword", nodeId: "node-3", userId: TEST_USER_ID, imageProvider: "not-a-model" },
    })
    expect(res.statusCode).toBe(200)
    expect(mockInsert).toHaveBeenCalledWith(expect.objectContaining({ image_provider: null }))
  })

  // selected_asset_by_variant (migration 205): OPAQUE per-variant "chosen take"
  // map. Keys stored VERBATIM (no normalization); soft-capped with overflow
  // dropped silently. Shared capSelectedAssetByVariant helper (same as characters).
  it("persists selected_asset_by_variant VERBATIM on insert", async () => {
    const mockSingle = vi.fn().mockResolvedValue({ data: { id: TEST_OBJECT_ID }, error: null })
    const mockSelect = vi.fn().mockReturnValue({ single: mockSingle })
    const mockInsert = vi.fn().mockReturnValue({ select: mockSelect })
    vi.mocked(supabase.from).mockReturnValue({ insert: mockInsert } as never)

    const res = await app.inject({
      method: "POST",
      url: "/v1/objects",
      payload: {
        name: "Sword",
        nodeId: "node-3",
        userId: TEST_USER_ID,
        selectedAssetByVariant: { "angles:Front 3/4": "https://example.com/f34.png" },
      },
    })
    expect(res.statusCode).toBe(200)
    expect(mockInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        selected_asset_by_variant: { "angles:Front 3/4": "https://example.com/f34.png" },
      }),
    )
  })

  it("soft-caps selected_asset_by_variant to 200 keys on insert (truncates, NOT a 400)", async () => {
    const captured: { row: Record<string, unknown> | null } = { row: null }
    const mockSingle = vi.fn().mockResolvedValue({ data: { id: TEST_OBJECT_ID }, error: null })
    const mockSelect = vi.fn().mockReturnValue({ single: mockSingle })
    const mockInsert = vi.fn((row: Record<string, unknown>) => {
      captured.row = row
      return { select: mockSelect }
    })
    vi.mocked(supabase.from).mockReturnValue({ insert: mockInsert } as never)

    const oversized: Record<string, string> = {}
    for (let i = 0; i < 250; i++) oversized[`angles:v${i}`] = `https://example.com/${i}.png`

    const res = await app.inject({
      method: "POST",
      url: "/v1/objects",
      payload: { name: "Sword", nodeId: "node-3", userId: TEST_USER_ID, selectedAssetByVariant: oversized },
    })
    expect(res.statusCode).toBe(200)
    expect(Object.keys(captured.row?.selected_asset_by_variant as Record<string, string>)).toHaveLength(200)
  })

  it("UPDATE writes selected_asset_by_variant while still EXCLUDING worker-owned buckets", async () => {
    const mockSingle = vi.fn().mockResolvedValue({
      data: { id: TEST_OBJECT_ID, updated_at: "2026-01-02T00:00:00Z" },
      error: null,
    })
    const mockSelect = vi.fn().mockReturnValue({ single: mockSingle })
    const chain: Record<string, unknown> = { eq: vi.fn().mockReturnThis(), select: mockSelect }
    const mockUpdate = vi.fn().mockReturnValue(chain)
    vi.mocked(supabase.from).mockReturnValue({ update: mockUpdate } as never)

    const res = await app.inject({
      method: "POST",
      url: "/v1/objects",
      payload: {
        id: TEST_OBJECT_ID,
        name: "Sword",
        nodeId: "node-3",
        userId: TEST_USER_ID,
        selectedAssetByVariant: { "materials:Brushed Steel": "https://example.com/steel.png" },
        // Worker-owned — must still be dropped from the UPDATE row.
        angles: [{ name: "stale", url: "https://r2.example.com/stale.png" }],
      },
    })
    expect(res.statusCode).toBe(200)
    const updateArg = vi.mocked(mockUpdate).mock.calls[0]?.[0] as Record<string, unknown>
    expect(updateArg.selected_asset_by_variant).toEqual({ "materials:Brushed Steel": "https://example.com/steel.png" })
    expect(updateArg).not.toHaveProperty("angles")
  })

  it("INSERT path accepts ALL fields incl. worker-owned (motionClips, angles, materials, variations)", async () => {
    const mockSingle = vi.fn().mockResolvedValue({ data: { id: TEST_OBJECT_ID }, error: null })
    const mockSelect = vi.fn().mockReturnValue({ single: mockSingle })
    const mockInsert = vi.fn().mockReturnValue({ select: mockSelect })
    vi.mocked(supabase.from).mockReturnValue({ insert: mockInsert } as never)

    const res = await app.inject({
      method: "POST",
      url: "/v1/objects",
      payload: {
        name: "Sword",
        nodeId: "node-3",
        userId: TEST_USER_ID,
        // Worker-owned columns — allowed on INSERT for template/import use.
        angles: [{ name: "front", url: "https://r2.example.com/a.png" }],
        materials: [{ name: "gold", url: "https://r2.example.com/m.png" }],
        variations: [{ name: "v1", url: "https://r2.example.com/v.png" }],
        motionClips: [{ name: "spin", url: "https://r2.example.com/spin.mp4" }],
        // User-owned + route-owned.
        referencePhotos: [{ kind: "wide", url: "https://r2.example.com/ref.png" }],
        canonicalDescription: "An ornate gold sword.",
        styleLock: false,
      },
    })

    expect(res.statusCode).toBe(200)
    // Worker- + route-owned values land on the INSERT row.
    expect(mockInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        angles: [{ name: "front", url: "https://r2.example.com/a.png" }],
        materials: [{ name: "gold", url: "https://r2.example.com/m.png" }],
        variations: [{ name: "v1", url: "https://r2.example.com/v.png" }],
        motion_clips: [{ name: "spin", url: "https://r2.example.com/spin.mp4" }],
        reference_photos: [{ kind: "wide", url: "https://r2.example.com/ref.png" }],
        canonical_description: "An ornate gold sword.",
        style_lock: false,
      }),
    )
  })

  it("returns 200 on update (id in body) and scopes by user_id", async () => {
    const mockSingle = vi.fn().mockResolvedValue({
      data: { id: TEST_OBJECT_ID, updated_at: "2026-01-02T00:00:00Z" },
      error: null,
    })
    const mockSelect = vi.fn().mockReturnValue({ single: mockSingle })
    const chain: Record<string, unknown> = {
      eq: vi.fn().mockReturnThis(),
      select: mockSelect,
    }
    const mockUpdate = vi.fn().mockReturnValue(chain)
    vi.mocked(supabase.from).mockReturnValue({ update: mockUpdate } as never)

    const res = await app.inject({
      method: "POST",
      url: "/v1/objects",
      payload: {
        id: TEST_OBJECT_ID,
        name: "Sword Updated",
        nodeId: "node-3",
        userId: TEST_USER_ID,
      },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ id: TEST_OBJECT_ID, updatedAt: "2026-01-02T00:00:00Z" })
    expect(mockUpdate).toHaveBeenCalled()
    expect(chain.eq).toHaveBeenCalledWith("id", TEST_OBJECT_ID)
    expect(chain.eq).toHaveBeenCalledWith("user_id", TEST_USER_ID)
  })

  it("UPDATE path EXCLUDES worker-owned columns (angles/materials/variations/motion_clips) AND route-owned (source_image_url/canonical_description)", async () => {
    const mockSingle = vi.fn().mockResolvedValue({
      data: { id: TEST_OBJECT_ID, updated_at: "2026-01-02T00:00:00Z" },
      error: null,
    })
    const mockSelect = vi.fn().mockReturnValue({ single: mockSingle })
    const chain: Record<string, unknown> = {
      eq: vi.fn().mockReturnThis(),
      select: mockSelect,
    }
    const mockUpdate = vi.fn().mockReturnValue(chain)
    vi.mocked(supabase.from).mockReturnValue({ update: mockUpdate } as never)

    const res = await app.inject({
      method: "POST",
      url: "/v1/objects",
      payload: {
        id: TEST_OBJECT_ID,
        name: "Sword v2",
        nodeId: "node-3",
        userId: TEST_USER_ID,
        // All of these should be silently DROPPED from the UPDATE row.
        sourceImageUrl: "https://r2.example.com/stale.png",
        angles: [{ name: "stale", url: "https://r2.example.com/stale-a.png" }],
        materials: [{ name: "stale", url: "https://r2.example.com/stale-m.png" }],
        variations: [{ name: "stale", url: "https://r2.example.com/stale-v.png" }],
        motionClips: [{ name: "stale", url: "https://r2.example.com/stale.mp4" }],
        canonicalDescription: "Should NOT overwrite worker write.",
        // These two ARE allowed on UPDATE.
        referencePhotos: [{ kind: "wide", url: "https://r2.example.com/ref.png" }],
        styleLock: false,
      },
    })

    expect(res.statusCode).toBe(200)
    const updateArg = vi.mocked(mockUpdate).mock.calls[0]?.[0] as Record<string, unknown>
    // Worker-owned + route-owned columns must NOT appear on the UPDATE row.
    expect(updateArg).not.toHaveProperty("source_image_url")
    expect(updateArg).not.toHaveProperty("angles")
    expect(updateArg).not.toHaveProperty("materials")
    expect(updateArg).not.toHaveProperty("variations")
    expect(updateArg).not.toHaveProperty("motion_clips")
    expect(updateArg).not.toHaveProperty("canonical_description")
    // User-owned columns DO appear.
    expect(updateArg).toMatchObject({
      name: "Sword v2",
      reference_photos: [{ kind: "wide", url: "https://r2.example.com/ref.png" }],
      style_lock: false,
    })
  })

  it("UPDATE with matching expectedUpdatedAt — succeeds with .eq('updated_at', token)", async () => {
    const mockSingle = vi.fn().mockResolvedValue({
      data: { id: TEST_OBJECT_ID, updated_at: "2026-01-03T00:00:00Z" },
      error: null,
    })
    const mockSelect = vi.fn().mockReturnValue({ single: mockSingle })
    const chain: Record<string, unknown> = {
      eq: vi.fn().mockReturnThis(),
      select: mockSelect,
    }
    const mockUpdate = vi.fn().mockReturnValue(chain)
    vi.mocked(supabase.from).mockReturnValue({ update: mockUpdate } as never)

    const res = await app.inject({
      method: "POST",
      url: "/v1/objects",
      payload: {
        id: TEST_OBJECT_ID,
        name: "Sword v3",
        nodeId: "node-3",
        userId: TEST_USER_ID,
        expectedUpdatedAt: "2026-01-02T00:00:00Z",
      },
    })

    expect(res.statusCode).toBe(200)
    // The concurrency token chains a third .eq() onto the query.
    expect(chain.eq).toHaveBeenCalledWith("updated_at", "2026-01-02T00:00:00Z")
  })

  it("UPDATE with stale expectedUpdatedAt — 409 concurrent_modification with fresh updatedAt", async () => {
    // First UPDATE returns no row (concurrency mismatch). Then the handler's
    // follow-up SELECT returns the current updated_at value.
    const mockUpdateSingle = vi.fn().mockResolvedValue({ data: null, error: null })
    const updateSelectChain = vi.fn().mockReturnValue({ single: mockUpdateSingle })
    const updateChain: Record<string, unknown> = {
      eq: vi.fn().mockReturnThis(),
      select: updateSelectChain,
    }
    const mockUpdate = vi.fn().mockReturnValue(updateChain)

    const mockCurrentSingle = vi.fn().mockResolvedValue({
      data: { updated_at: "2026-01-05T00:00:00Z" },
      error: null,
    })
    const currentChain: Record<string, unknown> = {
      eq: vi.fn().mockReturnThis(),
      single: mockCurrentSingle,
    }
    const mockCurrentSelect = vi.fn().mockReturnValue(currentChain)

    vi.mocked(supabase.from)
      .mockReturnValueOnce({ update: mockUpdate } as never)
      .mockReturnValueOnce({ select: mockCurrentSelect } as never)

    const res = await app.inject({
      method: "POST",
      url: "/v1/objects",
      payload: {
        id: TEST_OBJECT_ID,
        name: "Sword v4",
        nodeId: "node-3",
        userId: TEST_USER_ID,
        expectedUpdatedAt: "2026-01-02T00:00:00Z",
      },
    })

    expect(res.statusCode).toBe(409)
    expect(res.json().error.code).toBe("concurrent_modification")
    expect(res.json().error.updatedAt).toBe("2026-01-05T00:00:00Z")
  })

  it("UPDATE with no expectedUpdatedAt — concurrency check skipped, success", async () => {
    const mockSingle = vi.fn().mockResolvedValue({
      data: { id: TEST_OBJECT_ID, updated_at: "2026-01-02T00:00:00Z" },
      error: null,
    })
    const mockSelect = vi.fn().mockReturnValue({ single: mockSingle })
    const chain: Record<string, unknown> = {
      eq: vi.fn().mockReturnThis(),
      select: mockSelect,
    }
    const mockUpdate = vi.fn().mockReturnValue(chain)
    vi.mocked(supabase.from).mockReturnValue({ update: mockUpdate } as never)

    await app.inject({
      method: "POST",
      url: "/v1/objects",
      payload: {
        id: TEST_OBJECT_ID,
        name: "Sword v5",
        nodeId: "node-3",
        userId: TEST_USER_ID,
      },
    })

    // Without the concurrency token, only the 2 ownership .eq() calls fire.
    // Concretely: no .eq("updated_at", <anything>) call.
    const eqMock = chain.eq as ReturnType<typeof vi.fn>
    const calls = eqMock.mock.calls as [string, unknown][]
    expect(calls.some(([col]) => col === "updated_at")).toBe(false)
  })

  it("UPDATE on row that doesn't exist (no expectedUpdatedAt) — 404 not_found", async () => {
    const mockSingle = vi.fn().mockResolvedValue({
      data: null,
      error: { code: "PGRST116", message: "no row" },
    })
    const mockSelect = vi.fn().mockReturnValue({ single: mockSingle })
    const chain: Record<string, unknown> = {
      eq: vi.fn().mockReturnThis(),
      select: mockSelect,
    }
    const mockUpdate = vi.fn().mockReturnValue(chain)
    vi.mocked(supabase.from).mockReturnValue({ update: mockUpdate } as never)

    const res = await app.inject({
      method: "POST",
      url: "/v1/objects",
      payload: {
        id: TEST_OBJECT_ID,
        name: "Ghost",
        nodeId: "node-3",
        userId: TEST_USER_ID,
      },
    })

    expect(res.statusCode).toBe(404)
    expect(res.json().error.code).toBe("not_found")
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
      url: "/v1/objects",
      payload: { name: "Sword", nodeId: "node-3", userId: TEST_USER_ID },
    })

    expect(res.statusCode).toBe(500)
    expect(res.json().error.code).toBe("internal_error")
  })
})

// ---------------------------------------------------------------------------
// DELETE /v1/objects/:id (soft-delete)
// ---------------------------------------------------------------------------

describe("DELETE /v1/objects/:id (soft-delete)", () => {
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
      url: `/v1/objects/${TEST_OBJECT_ID}`,
    })
    expect(res.statusCode).toBe(401)
    expect(res.json().error.code).toBe("unauthorized")
  })

  it("returns 200 on success, scopes by user_id, returns archived: true", async () => {
    const { mockUpdate, chain } = softDeleteChain({ error: null })
    vi.mocked(supabase.from).mockReturnValue({ update: mockUpdate } as never)

    const res = await app.inject({
      method: "DELETE",
      url: `/v1/objects/${TEST_OBJECT_ID}`,
      headers: { "x-user-id": TEST_USER_ID },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ success: true, archived: true })
    expect(chain.eq).toHaveBeenCalledWith("id", TEST_OBJECT_ID)
    expect(chain.eq).toHaveBeenCalledWith("user_id", TEST_USER_ID)
    // Only active rows can be archived — second archive is a no-op
    // (idempotency guard).
    expect(chain.is).toHaveBeenCalledWith("deleted_at", null)
  })

  it("returns 500 with delete_failed on DB error", async () => {
    const { mockUpdate } = softDeleteChain({ error: { message: "FK constraint" } })
    vi.mocked(supabase.from).mockReturnValue({ update: mockUpdate } as never)

    const res = await app.inject({
      method: "DELETE",
      url: `/v1/objects/${TEST_OBJECT_ID}`,
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
      url: `/v1/objects/${TEST_OBJECT_ID}?permanent=false`,
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
// DELETE /v1/objects/:id?permanent=true (hard-delete + R2 cleanup)
// ---------------------------------------------------------------------------

describe("DELETE /v1/objects/:id?permanent=true", () => {
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
      url: `/v1/objects/${TEST_OBJECT_ID}?permanent=true`,
    })
    expect(res.statusCode).toBe(401)
    expect(res.json().error.code).toBe("unauthorized")
  })

  it("returns 404 not_found when the row doesn't exist or is owned by another user (uniform code, no info leak)", async () => {
    // The ownership SELECT returns no row — the handler short-circuits before
    // any R2 collection or DB delete fires.
    const { mockSelect: ownerSelect } = ownershipChain({ data: null, error: null })
    vi.mocked(supabase.from).mockReturnValueOnce({ select: ownerSelect } as never)

    const res = await app.inject({
      method: "DELETE",
      url: `/v1/objects/${TEST_OBJECT_ID}?permanent=true`,
      headers: { "x-user-id": TEST_USER_ID },
    })

    expect(res.statusCode).toBe(404)
    expect(res.json().error.code).toBe("not_found")
    expect(batchDeleteFromR2).not.toHaveBeenCalled()
  })

  it("returns 400 not_archived when the row is still active (archive-first policy)", async () => {
    // Row exists + owned but `deleted_at` is null → must archive first.
    const { mockSelect: ownerSelect } = ownershipChain({
      data: { id: TEST_OBJECT_ID, deleted_at: null },
      error: null,
    })
    vi.mocked(supabase.from).mockReturnValueOnce({ select: ownerSelect } as never)

    const res = await app.inject({
      method: "DELETE",
      url: `/v1/objects/${TEST_OBJECT_ID}?permanent=true`,
      headers: { "x-user-id": TEST_USER_ID },
    })

    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("not_archived")
    expect(batchDeleteFromR2).not.toHaveBeenCalled()
  })

  it("hard-deletes an archived row + batch-deletes only R2-hosted asset keys across all 6 asset-bearing columns", async () => {
    // Archived row + a mix of R2-hosted and external CDN URLs across every
    // JSONB column we scan. The handler must extract keys for the R2 URLs
    // and skip the external ones (no spurious R2 deletes).
    const ASSET_ROW = {
      source_image_url: "https://r2.example.com/objects/sword/main.png",
      angles: [{ name: "front", url: "https://r2.example.com/objects/sword/angle-front.png" }],
      materials: [{ name: "gold", url: "https://cdn.external.com/material-gold.png" }], // external — skipped
      variations: [{ name: "v1", url: "https://r2.example.com/objects/sword/var-1.png" }],
      motion_clips: [
        { name: "spin", url: "https://r2.example.com/objects/sword/spin.mp4" },
      ],
      reference_photos: [
        { kind: "wide", url: "https://r2.example.com/objects/sword/ref1.jpg" },
        { kind: "detail", url: "https://cdn.external.com/ref2.jpg" }, // external — skipped
      ],
    }

    const { mockSelect: ownerSelect } = ownershipChain({
      data: { id: TEST_OBJECT_ID, deleted_at: "2026-05-01T00:00:00Z", ...ASSET_ROW },
      error: null,
    })
    const { mockDelete, chain: deleteChain } = hardDeleteChain({ error: null })

    vi.mocked(supabase.from)
      .mockReturnValueOnce({ select: ownerSelect } as never) // ownership + R2 keys
      .mockReturnValueOnce({ delete: mockDelete } as never) // hard-delete

    const res = await app.inject({
      method: "DELETE",
      url: `/v1/objects/${TEST_OBJECT_ID}?permanent=true`,
      headers: { "x-user-id": TEST_USER_ID },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ success: true, permanent: true })

    // 5 R2-hosted URLs across source_image_url + angles + variations +
    // motion_clips + reference_photos. The 2 external URLs are skipped.
    expect(batchDeleteFromR2).toHaveBeenCalledTimes(1)
    const keysArg = vi.mocked(batchDeleteFromR2).mock.calls[0]?.[0] ?? []
    expect(keysArg).toEqual([
      "objects/sword/main.png",
      "objects/sword/angle-front.png",
      "objects/sword/var-1.png",
      "objects/sword/spin.mp4",
      "objects/sword/ref1.jpg",
    ])

    // Hard-delete must be scoped by both id AND user_id — defense in depth
    // against the ownership check above being somehow bypassed.
    expect(mockDelete).toHaveBeenCalled()
    expect(deleteChain.eq).toHaveBeenCalledWith("id", TEST_OBJECT_ID)
    expect(deleteChain.eq).toHaveBeenCalledWith("user_id", TEST_USER_ID)
  })

  it("skips batch-delete when the row has no R2-hosted assets", async () => {
    // All-empty asset row → no keys collected → batchDeleteFromR2 not called.
    // Guards against an extra round trip for archived rows with no assets.
    const EMPTY_ASSETS = {
      source_image_url: null,
      angles: [],
      materials: [],
      variations: [],
      motion_clips: [],
      reference_photos: [],
    }
    const { mockSelect: ownerSelect } = ownershipChain({
      data: { id: TEST_OBJECT_ID, deleted_at: "2026-05-01T00:00:00Z", ...EMPTY_ASSETS },
      error: null,
    })
    const { mockDelete } = hardDeleteChain({ error: null })

    vi.mocked(supabase.from)
      .mockReturnValueOnce({ select: ownerSelect } as never)
      .mockReturnValueOnce({ delete: mockDelete } as never)

    const res = await app.inject({
      method: "DELETE",
      url: `/v1/objects/${TEST_OBJECT_ID}?permanent=true`,
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
      angles: [],
      materials: [],
      variations: [],
      motion_clips: [],
      reference_photos: [],
    }
    const { mockSelect: ownerSelect } = ownershipChain({
      data: { id: TEST_OBJECT_ID, deleted_at: "2026-05-01T00:00:00Z", ...EMPTY_ASSETS },
      error: null,
    })
    const { mockDelete } = hardDeleteChain({ error: { message: "FK violation" } })

    vi.mocked(supabase.from)
      .mockReturnValueOnce({ select: ownerSelect } as never)
      .mockReturnValueOnce({ delete: mockDelete } as never)

    const res = await app.inject({
      method: "DELETE",
      url: `/v1/objects/${TEST_OBJECT_ID}?permanent=true`,
      headers: { "x-user-id": TEST_USER_ID },
    })

    expect(res.statusCode).toBe(500)
    expect(res.json().error.code).toBe("delete_failed")
  })

  it("returns 400 validation_error on bogus query value", async () => {
    const res = await app.inject({
      method: "DELETE",
      url: `/v1/objects/${TEST_OBJECT_ID}?permanent=banana`,
      headers: { "x-user-id": TEST_USER_ID },
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("validation_error")
  })
})
