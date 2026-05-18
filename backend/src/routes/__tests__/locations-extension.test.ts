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
// Fixtures
// ---------------------------------------------------------------------------

const TEST_USER_ID = "00000000-0000-4000-8000-000000000001"
const TEST_PROJECT_ID = "00000000-0000-4000-8000-000000000010"
const TEST_LOCATION_ID = "00000000-0000-4000-8000-000000000030"

const DB_LOCATION_FULL = {
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

// ---------------------------------------------------------------------------
// App harness
// ---------------------------------------------------------------------------

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
// POST /v1/locations — extended fields
// ---------------------------------------------------------------------------

describe("POST /v1/locations — new fields", () => {
  it("accepts new fields and persists them on INSERT", async () => {
    const mockSingle = vi.fn().mockResolvedValue({ data: { id: TEST_LOCATION_ID }, error: null })
    const mockSelect = vi.fn().mockReturnValue({ single: mockSingle })
    const mockInsert = vi.fn().mockReturnValue({ select: mockSelect })
    vi.mocked(supabase.from).mockReturnValue({ insert: mockInsert } as never)

    const res = await app.inject({
      method: "POST",
      url: "/v1/locations",
      payload: {
        name: "Cabin",
        nodeId: "node-2",
        userId: TEST_USER_ID,
        lighting: [{ name: "golden", url: "https://example.com/lighting.png" }],
        seasons: [{ name: "winter", url: "https://example.com/winter.png" }],
        atmosphereMotions: [{ name: "drizzle", url: "https://example.com/drizzle.mp4" }],
        referencePhotos: [{ kind: "exterior", url: "https://example.com/ref.png" }],
        canonicalDescription: "A small wooden cabin in a snow-covered clearing.",
        styleLock: false,
      },
    })

    expect(res.statusCode).toBe(200)
    expect(mockInsert).toHaveBeenCalledTimes(1)
    const inserted = mockInsert.mock.calls[0]?.[0] as Record<string, unknown>
    expect(inserted.lighting).toEqual([{ name: "golden", url: "https://example.com/lighting.png" }])
    expect(inserted.seasons).toEqual([{ name: "winter", url: "https://example.com/winter.png" }])
    expect(inserted.atmosphere_motions).toEqual([{ name: "drizzle", url: "https://example.com/drizzle.mp4" }])
    expect(inserted.reference_photos).toEqual([{ kind: "exterior", url: "https://example.com/ref.png" }])
    expect(inserted.canonical_description).toBe("A small wooden cabin in a snow-covered clearing.")
    expect(inserted.style_lock).toBe(false)
  })

  it("UPDATE excludes worker-owned columns (lighting/seasons/atmosphere_motions/time_of_day/weather/angles)", async () => {
    const mockSingle = vi
      .fn()
      .mockResolvedValue({ data: { id: TEST_LOCATION_ID, updated_at: "2026-01-02T00:00:00Z" }, error: null })
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
        name: "Forest renamed",
        nodeId: "node-2",
        userId: TEST_USER_ID,
        // These must NOT make it into the UPDATE patch:
        lighting: [{ name: "x", url: "https://example.com/x.png" }],
        seasons: [{ name: "y", url: "https://example.com/y.png" }],
        atmosphereMotions: [{ name: "z", url: "https://example.com/z.mp4" }],
        timeOfDay: [{ name: "n", url: "https://example.com/n.png" }],
        weather: [{ name: "w", url: "https://example.com/w.png" }],
        angles: [{ name: "a", url: "https://example.com/a.png" }],
        // These SHOULD make it through:
        referencePhotos: [{ kind: "wide", url: "https://example.com/wide.png" }],
        canonicalDescription: "Updated caption.",
        styleLock: true,
      },
    })

    expect(res.statusCode).toBe(200)
    expect(mockUpdate).toHaveBeenCalledTimes(1)
    const patch = mockUpdate.mock.calls[0]?.[0] as Record<string, unknown>
    // Excluded:
    expect(patch).not.toHaveProperty("lighting")
    expect(patch).not.toHaveProperty("seasons")
    expect(patch).not.toHaveProperty("atmosphere_motions")
    expect(patch).not.toHaveProperty("time_of_day")
    expect(patch).not.toHaveProperty("weather")
    expect(patch).not.toHaveProperty("angles")
    // Included:
    expect(patch.name).toBe("Forest renamed")
    expect(patch.reference_photos).toEqual([{ kind: "wide", url: "https://example.com/wide.png" }])
    expect(patch.canonical_description).toBe("Updated caption.")
    expect(patch.style_lock).toBe(true)
  })

  it("returns 409 when expectedUpdatedAt is stale", async () => {
    // First call: UPDATE returns no row (the .eq("updated_at", stale) filtered everything out)
    const mockUpdateSingle = vi.fn().mockResolvedValue({ data: null, error: { code: "PGRST116", message: "no row" } })
    const mockUpdateSelect = vi.fn().mockReturnValue({ single: mockUpdateSingle })
    const updateChain: Record<string, unknown> = {
      eq: vi.fn().mockReturnThis(),
      select: mockUpdateSelect,
    }
    const mockUpdate = vi.fn().mockReturnValue(updateChain)

    // Second call: SELECT the current row to get its updated_at
    const mockSelectSingle = vi.fn().mockResolvedValue({
      data: {
        updated_at: "2026-02-01T00:00:00Z",
        name: "Forest",
        source_image_url: "https://example.com/forest.png",
        canonical_description: null,
      },
      error: null,
    })
    const selectChain: Record<string, unknown> = {
      eq: vi.fn().mockReturnThis(),
      single: mockSelectSingle,
    }
    const mockSelect = vi.fn().mockReturnValue(selectChain)

    vi.mocked(supabase.from)
      .mockReturnValueOnce({ update: mockUpdate } as never)
      .mockReturnValueOnce({ select: mockSelect } as never)

    const res = await app.inject({
      method: "POST",
      url: "/v1/locations",
      payload: {
        id: TEST_LOCATION_ID,
        name: "Forest Updated",
        nodeId: "node-2",
        userId: TEST_USER_ID,
        expectedUpdatedAt: "2026-01-01T00:00:00Z", // stale
      },
    })

    expect(res.statusCode).toBe(409)
    const body = res.json()
    expect(body.error.code).toBe("concurrent_modification")
    expect(body.error.updatedAt).toBe("2026-02-01T00:00:00Z")
    expect(body.error.message).toBeTruthy()
    // 409 body must be minimal — no row payload (DD-5)
    expect(body.error).not.toHaveProperty("row")
    expect(body.error).not.toHaveProperty("name")
    expect(body.error).not.toHaveProperty("sourceImageUrl")
  })
})

// ---------------------------------------------------------------------------
// GET /v1/locations — archived filter
// ---------------------------------------------------------------------------

describe("GET /v1/locations — archived filter", () => {
  it("returns archived only when ?archived=true", async () => {
    const chainable: Record<string, unknown> = {
      eq: vi.fn().mockReturnThis(),
      not: vi.fn().mockReturnThis(),
      is: vi.fn().mockReturnThis(),
    }
    chainable.then = (resolve: (value: { data: unknown; error: unknown }) => unknown) =>
      Promise.resolve({ data: [], error: null }).then(resolve)
    const mockOrder = vi.fn().mockReturnValue(chainable)
    const mockSelect = vi.fn().mockReturnValue({ order: mockOrder })
    vi.mocked(supabase.from).mockReturnValue({ select: mockSelect } as never)

    const res = await app.inject({
      method: "GET",
      url: "/v1/locations?archived=true",
      headers: { "x-user-id": TEST_USER_ID },
    })

    expect(res.statusCode).toBe(200)
    expect(chainable.not).toHaveBeenCalledWith("deleted_at", "is", null)
    expect(chainable.is).not.toHaveBeenCalledWith("deleted_at", null)
  })

  it("hides archived by default", async () => {
    const chainable: Record<string, unknown> = {
      eq: vi.fn().mockReturnThis(),
      not: vi.fn().mockReturnThis(),
      is: vi.fn().mockReturnThis(),
    }
    chainable.then = (resolve: (value: { data: unknown; error: unknown }) => unknown) =>
      Promise.resolve({ data: [], error: null }).then(resolve)
    const mockOrder = vi.fn().mockReturnValue(chainable)
    const mockSelect = vi.fn().mockReturnValue({ order: mockOrder })
    vi.mocked(supabase.from).mockReturnValue({ select: mockSelect } as never)

    const res = await app.inject({
      method: "GET",
      url: "/v1/locations",
      headers: { "x-user-id": TEST_USER_ID },
    })

    expect(res.statusCode).toBe(200)
    expect(chainable.is).toHaveBeenCalledWith("deleted_at", null)
    expect(chainable.not).not.toHaveBeenCalledWith("deleted_at", "is", null)
  })
})

// ---------------------------------------------------------------------------
// GET /v1/locations/:id — pendingJobs + null→"" coercion
// ---------------------------------------------------------------------------

describe("GET /v1/locations/:id — pendingJobs + canonicalDescription coercion", () => {
  it("returns pendingJobs array filtered by attachToLocationId", async () => {
    // First .from() call: SELECT the location row
    const locationSingle = vi.fn().mockResolvedValue({ data: DB_LOCATION_FULL, error: null })
    const locationChain: Record<string, unknown> = {
      eq: vi.fn().mockReturnThis(),
      single: locationSingle,
    }
    const locationSelect = vi.fn().mockReturnValue(locationChain)

    // Second .from() call: SELECT pending jobs
    const jobsRows = [
      {
        id: "job-1",
        input_data: { attachToColumn: "lighting", attachName: "Golden Hour", assetType: "lighting" },
        status: "pending",
      },
      {
        id: "job-2",
        input_data: { attachToColumn: "seasons", attachName: "Winter", assetType: "seasons" },
        status: "running",
      },
    ]
    const jobsChain: Record<string, unknown> = {
      eq: vi.fn().mockReturnThis(),
      in: vi.fn().mockReturnThis(),
      filter: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue({ data: jobsRows, error: null }),
    }
    const jobsSelect = vi.fn().mockReturnValue(jobsChain)

    vi.mocked(supabase.from)
      .mockReturnValueOnce({ select: locationSelect } as never)
      .mockReturnValueOnce({ select: jobsSelect } as never)

    const res = await app.inject({
      method: "GET",
      url: `/v1/locations/${TEST_LOCATION_ID}`,
      headers: { "x-user-id": TEST_USER_ID },
    })

    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.pendingJobs).toEqual([
      { jobId: "job-1", assetType: "lighting", name: "Golden Hour", status: "pending" },
      { jobId: "job-2", assetType: "seasons", name: "Winter", status: "running" },
    ])
    // Verify the filter targets attachToLocationId
    expect(jobsChain.filter).toHaveBeenCalledWith("input_data->>attachToLocationId", "eq", TEST_LOCATION_ID)
    // Verify pendingJobs LIMIT 100
    expect(jobsChain.limit).toHaveBeenCalledWith(100)
  })

  it("coerces null canonical_description to empty string", async () => {
    const locationSingle = vi.fn().mockResolvedValue({
      data: { ...DB_LOCATION_FULL, canonical_description: null },
      error: null,
    })
    const locationChain: Record<string, unknown> = {
      eq: vi.fn().mockReturnThis(),
      single: locationSingle,
    }
    const locationSelect = vi.fn().mockReturnValue(locationChain)
    const jobsChain: Record<string, unknown> = {
      eq: vi.fn().mockReturnThis(),
      in: vi.fn().mockReturnThis(),
      filter: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue({ data: [], error: null }),
    }
    const jobsSelect = vi.fn().mockReturnValue(jobsChain)

    vi.mocked(supabase.from)
      .mockReturnValueOnce({ select: locationSelect } as never)
      .mockReturnValueOnce({ select: jobsSelect } as never)

    const res = await app.inject({
      method: "GET",
      url: `/v1/locations/${TEST_LOCATION_ID}`,
      headers: { "x-user-id": TEST_USER_ID },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json().canonicalDescription).toBe("")
  })
})

// ---------------------------------------------------------------------------
// DELETE /v1/locations/:id — soft-delete
// ---------------------------------------------------------------------------

describe("DELETE /v1/locations/:id — soft-delete", () => {
  it("sets deleted_at instead of removing the row, returns archived:true", async () => {
    const chain: Record<string, unknown> = {
      eq: vi.fn().mockReturnThis(),
      is: vi.fn().mockReturnThis(),
      then: (resolve: (value: { error: unknown }) => unknown) =>
        Promise.resolve({ error: null }).then(resolve),
    }
    const mockUpdate = vi.fn().mockReturnValue(chain)
    vi.mocked(supabase.from).mockReturnValue({ update: mockUpdate } as never)

    const res = await app.inject({
      method: "DELETE",
      url: `/v1/locations/${TEST_LOCATION_ID}`,
      headers: { "x-user-id": TEST_USER_ID },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ success: true, archived: true })
    // The UPDATE patch sets deleted_at
    const patch = mockUpdate.mock.calls[0]?.[0] as Record<string, unknown>
    expect(typeof patch.deleted_at).toBe("string")
    // And scopes by user + only-active
    expect(chain.eq).toHaveBeenCalledWith("id", TEST_LOCATION_ID)
    expect(chain.eq).toHaveBeenCalledWith("user_id", TEST_USER_ID)
    expect(chain.is).toHaveBeenCalledWith("deleted_at", null)
  })
})
