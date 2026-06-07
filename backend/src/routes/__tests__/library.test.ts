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
    R2_PUBLIC_URL: "https://pub-test.r2.dev",
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

vi.mock("@/middleware/credit-guard.js", () => ({
  creditGuard: () => async () => {},
  reserveCreditsForJob: vi.fn().mockResolvedValue({
    usageLogId: "usage-1",
    creditsReserved: 1,
    watermark: false,
  }),
}))

vi.mock("@/lib/url-validator.js", async () => {
  const { z } = await import("zod")
  return { safeUrlSchema: z.string().url() }
})

vi.mock("@/lib/storage.js", () => ({
  deleteFromR2: vi.fn().mockResolvedValue(undefined),
  s3: {},
}))

vi.mock("@/utils/file-validation.js", () => ({
  updateStorageUsage: vi.fn().mockResolvedValue(undefined),
}))

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import { libraryRoutes } from "../library.js"
import { supabase } from "../../lib/supabase.js"

// ---------------------------------------------------------------------------
// Test app setup
// ---------------------------------------------------------------------------

const TEST_USER_ID = "00000000-0000-4000-8000-000000000001"
const OTHER_USER_ID = "00000000-0000-4000-8000-000000000099"

let app: FastifyInstance

beforeEach(async () => {
  vi.clearAllMocks()

  app = Fastify({ logger: false })

  // Bypass auth — set userId from request body or query for protected routes
  app.addHook("preHandler", async (req) => {
    const body = req.body as Record<string, unknown> | undefined
    const query = req.query as Record<string, unknown> | undefined
    const userId = body?.userId ?? query?.userId
    if (userId && typeof userId === "string") {
      req.userId = userId
      req.userRole = undefined
    }
  })

  await app.register(async (instance) => {
    await libraryRoutes(instance)
  })

  await app.ready()
})

afterEach(async () => {
  await app.close()
})

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createChainMock(result: { data: unknown; error: unknown }) {
  const chain: Record<string, unknown> = {}
  const handler: ProxyHandler<Record<string, unknown>> = {
    get(target, prop) {
      if (prop === "then") {
        return (resolve: (v: unknown) => void) => resolve(result)
      }
      return (..._args: unknown[]) => proxy
    },
  }
  const proxy = new Proxy(chain, handler)
  return proxy
}

// ---------------------------------------------------------------------------
// Tests — GET /v1/library
// ---------------------------------------------------------------------------

describe("GET /v1/library", () => {
  it("returns 401 when no auth", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/library",
    })

    expect(res.statusCode).toBe(401)
    const body = res.json()
    expect(body.error.code).toBe("unauthorized")
  })

  it("returns paginated list with items", async () => {
    const mockAssets = [
      {
        id: "asset-1",
        user_id: TEST_USER_ID,
        type: "image",
        filename: "photo.png",
        mime_type: "image/png",
        size_bytes: 1024,
        r2_key: "images/asset-1.png",
        r2_url: "https://pub-test.r2.dev/images/asset-1.png",
        metadata: {},
        is_library_item: false,
        upload_source: "manual_upload",
        created_at: "2026-01-01T00:00:00Z",
      },
      {
        id: "asset-2",
        user_id: TEST_USER_ID,
        type: "video",
        filename: "clip.mp4",
        mime_type: "video/mp4",
        size_bytes: 2048,
        r2_key: "videos/asset-2.mp4",
        r2_url: "https://pub-test.r2.dev/videos/asset-2.mp4",
        metadata: { thumbnail_url: "https://pub-test.r2.dev/thumbs/asset-2.jpg" },
        is_library_item: false,
        upload_source: "generated",
        created_at: "2026-01-02T00:00:00Z",
      },
    ]

    vi.mocked(supabase.from).mockReturnValue(
      createChainMock({ data: mockAssets, error: null }) as never,
    )

    const res = await app.inject({
      method: "GET",
      url: `/v1/library?userId=${TEST_USER_ID}`,
    })

    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.data).toHaveLength(2)
    expect(body.data[0]).toHaveProperty("id", "asset-1")
    expect(body.data[0]).toHaveProperty("mimeType", "image/png")
    expect(body.data[0]).toHaveProperty("url", "https://pub-test.r2.dev/images/asset-1.png")
    expect(body.data[1]).toHaveProperty("thumbnailUrl", "https://pub-test.r2.dev/thumbs/asset-2.jpg")
    expect(body.nextCursor).toBeNull()
  })

  it("supports type filter", async () => {
    vi.mocked(supabase.from).mockReturnValue(
      createChainMock({ data: [], error: null }) as never,
    )

    const res = await app.inject({
      method: "GET",
      url: `/v1/library?userId=${TEST_USER_ID}&type=audio`,
    })

    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.data).toEqual([])
    expect(supabase.from).toHaveBeenCalledWith("assets")
  })
})

// ---------------------------------------------------------------------------
// Tests — DELETE /v1/library/:id
// ---------------------------------------------------------------------------

describe("DELETE /v1/library/:id", () => {
  it("soft remove sets in_library=false (no ownership error)", async () => {
    const assetId = "00000000-0000-4000-8000-000000000010"

    // Mock: update succeeds (eq on user_id means no rows affected if wrong owner, but no error)
    vi.mocked(supabase.from).mockImplementation(() => {
      const chain: Record<string, unknown> = {}
      chain.update = vi.fn().mockReturnValue(chain)
      chain.eq = vi.fn().mockReturnValue(chain)
      ;(chain as Record<string, unknown>).error = null
      return chain as never
    })

    const res = await app.inject({
      method: "DELETE",
      url: `/v1/library/${assetId}?userId=${TEST_USER_ID}`,
    })

    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.success).toBe(true)
  })

  it("permanent delete returns 403 for wrong owner", async () => {
    const assetId = "00000000-0000-4000-8000-000000000010"

    // Mock: asset lookup returns asset owned by a different user
    vi.mocked(supabase.from).mockImplementation(() => {
      const chain: Record<string, unknown> = {}
      chain.select = vi.fn().mockReturnValue(chain)
      chain.eq = vi.fn().mockReturnValue(chain)
      chain.single = vi.fn().mockResolvedValue({
        data: {
          id: assetId,
          user_id: OTHER_USER_ID,
          r2_key: "images/other.png",
          size_bytes: 512,
        },
        error: null,
      })
      return chain as never
    })

    const res = await app.inject({
      method: "DELETE",
      url: `/v1/library/${assetId}?userId=${TEST_USER_ID}&permanent=true`,
    })

    expect(res.statusCode).toBe(403)
    const body = res.json()
    expect(body.error.code).toBe("forbidden")
    expect(body.error.message).toContain("own")
  })

  it("permanent delete SKIPS the R2 delete when another asset references the same r2_key", async () => {
    const assetId = "00000000-0000-4000-8000-000000000010"
    const { deleteFromR2 } = await import("@/lib/storage.js")
    vi.mocked(deleteFromR2).mockClear()

    vi.mocked(supabase.from).mockImplementation(() => {
      const chain: Record<string, unknown> = {}
      chain.select = vi.fn().mockReturnValue(chain)
      // Jobs referrer-count queries end in .eq("output_data->>…", url) → resolve a
      // count; every other .eq() (id, user_id, r2_key) chains. (Not reached here:
      // an asset referrer short-circuits the jobs check.)
      chain.eq = vi.fn().mockImplementation((col: string) =>
        typeof col === "string" && col.startsWith("output_data->>")
          ? Promise.resolve({ count: 0, error: null })
          : chain,
      )
      chain.delete = vi.fn().mockReturnValue(chain)
      chain.single = vi.fn().mockResolvedValue({
        data: { id: assetId, user_id: TEST_USER_ID, r2_key: "images/shared.png", size_bytes: 100 },
        error: null,
      })
      // The assets referrer-count query ends in .neq(...) and is awaited → resolve a count.
      chain.neq = vi.fn().mockResolvedValue({ count: 1, error: null })
      ;(chain as Record<string, unknown>).error = null
      return chain as never
    })

    const res = await app.inject({
      method: "DELETE",
      url: `/v1/library/${assetId}?userId=${TEST_USER_ID}&permanent=true`,
    })

    expect(res.statusCode).toBe(200)
    // Regression: another row references the same content-addressed object, so
    // deleting it would break that row. The R2 object MUST be preserved.
    expect(vi.mocked(deleteFromR2)).not.toHaveBeenCalled()
  })

  it("permanent delete SKIPS the R2 delete when a jobs.output_data row references the same r2_key", async () => {
    // Data-loss regression: a normal generation = 1 job + 1 asset sharing one
    // r2_key. There is NO other *asset* row, so the assets-only check passes —
    // but jobs.output_data (what the gallery/job-history reads) still points at
    // the same R2 object. Deleting it would orphan the gallery entry forever.
    const assetId = "00000000-0000-4000-8000-000000000012"
    const r2Key = "images/gen-output.png"
    const publicUrl = `https://pub-test.r2.dev/${r2Key}`
    const { deleteFromR2 } = await import("@/lib/storage.js")
    vi.mocked(deleteFromR2).mockClear()

    const deleteSpy = vi.fn().mockReturnValue(undefined)

    vi.mocked(supabase.from).mockImplementation(() => {
      const chain: Record<string, unknown> = {}
      chain.select = vi.fn().mockReturnValue(chain)
      // A jobs row owned by this user references the object via output_data; the
      // per-key jobs query ends in .eq("output_data->>…", publicUrl) (value passed
      // as an arg so supabase-js encodes the URL safely — no .or() string parsing).
      chain.eq = vi.fn().mockImplementation((col: string, val?: unknown) => {
        if (typeof col === "string" && col.startsWith("output_data->>")) {
          expect(val).toBe(publicUrl)
          return Promise.resolve({ count: 1, error: null })
        }
        return chain
      })
      chain.delete = vi.fn().mockImplementation(() => {
        deleteSpy()
        return chain
      })
      chain.single = vi.fn().mockResolvedValue({
        data: { id: assetId, user_id: TEST_USER_ID, r2_key: r2Key, size_bytes: 100 },
        error: null,
      })
      // No OTHER asset row references the object → assets check is clear.
      chain.neq = vi.fn().mockResolvedValue({ count: 0, error: null })
      ;(chain as Record<string, unknown>).error = null
      return chain as never
    })

    const res = await app.inject({
      method: "DELETE",
      url: `/v1/library/${assetId}?userId=${TEST_USER_ID}&permanent=true`,
    })

    expect(res.statusCode).toBe(200)
    // The R2 object MUST be preserved (the job/gallery entry still needs it)...
    expect(vi.mocked(deleteFromR2)).not.toHaveBeenCalled()
    // ...but the asset DB row IS still deleted (only the R2 delete is gated).
    expect(deleteSpy).toHaveBeenCalled()
  })

  it("permanent delete SKIPS the R2 delete when the jobs referrer query errors (fail safe)", async () => {
    const assetId = "00000000-0000-4000-8000-000000000013"
    const { deleteFromR2 } = await import("@/lib/storage.js")
    vi.mocked(deleteFromR2).mockClear()

    vi.mocked(supabase.from).mockImplementation(() => {
      const chain: Record<string, unknown> = {}
      chain.select = vi.fn().mockReturnValue(chain)
      // Jobs check errors → we can't prove there's no referrer → fail safe.
      chain.eq = vi.fn().mockImplementation((col: string) =>
        typeof col === "string" && col.startsWith("output_data->>")
          ? Promise.resolve({ count: null, error: { message: "db down" } })
          : chain,
      )
      chain.delete = vi.fn().mockReturnValue(chain)
      chain.single = vi.fn().mockResolvedValue({
        data: { id: assetId, user_id: TEST_USER_ID, r2_key: "images/maybe-shared.png", size_bytes: 100 },
        error: null,
      })
      chain.neq = vi.fn().mockResolvedValue({ count: 0, error: null })
      ;(chain as Record<string, unknown>).error = null
      return chain as never
    })

    const res = await app.inject({
      method: "DELETE",
      url: `/v1/library/${assetId}?userId=${TEST_USER_ID}&permanent=true`,
    })

    expect(res.statusCode).toBe(200)
    expect(vi.mocked(deleteFromR2)).not.toHaveBeenCalled()
  })

  it("permanent delete DOES delete the R2 object when no other asset or job references it", async () => {
    const assetId = "00000000-0000-4000-8000-000000000011"
    const { deleteFromR2 } = await import("@/lib/storage.js")
    vi.mocked(deleteFromR2).mockClear()

    vi.mocked(supabase.from).mockImplementation(() => {
      const chain: Record<string, unknown> = {}
      chain.select = vi.fn().mockReturnValue(chain)
      // No job references it either → per-key output_data .eq() returns 0.
      chain.eq = vi.fn().mockImplementation((col: string) =>
        typeof col === "string" && col.startsWith("output_data->>")
          ? Promise.resolve({ count: 0, error: null })
          : chain,
      )
      chain.delete = vi.fn().mockReturnValue(chain)
      chain.single = vi.fn().mockResolvedValue({
        data: { id: assetId, user_id: TEST_USER_ID, r2_key: "images/sole.png", size_bytes: 100 },
        error: null,
      })
      chain.neq = vi.fn().mockResolvedValue({ count: 0, error: null })
      ;(chain as Record<string, unknown>).error = null
      return chain as never
    })

    const res = await app.inject({
      method: "DELETE",
      url: `/v1/library/${assetId}?userId=${TEST_USER_ID}&permanent=true`,
    })

    expect(res.statusCode).toBe(200)
    expect(vi.mocked(deleteFromR2)).toHaveBeenCalledWith("images/sole.png")
  })
})
