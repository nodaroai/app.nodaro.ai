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

vi.mock("@/ee/billing/credits.js", () => ({
  estimateWorkflowCredits: vi.fn().mockReturnValue(10),
}))

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import { publishedAppsRoutes } from "../published-apps.js"
import { supabase } from "../../lib/supabase.js"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TEST_USER_ID = "00000000-0000-4000-8000-000000000001"
const OTHER_USER_ID = "00000000-0000-4000-8000-000000000099"
const TEST_APP_ID = "00000000-0000-4000-8000-000000000040"

let app: FastifyInstance

beforeEach(async () => {
  vi.clearAllMocks()

  app = Fastify({ logger: false })

  // Bypass auth — set userId from header
  app.addHook("preHandler", async (req) => {
    const header = req.headers["x-user-id"]
    if (header && typeof header === "string") {
      req.userId = header
      req.userRole = undefined
    }
  })

  await app.register(async (instance) => {
    await publishedAppsRoutes(instance)
  })

  await app.ready()
})

afterEach(async () => {
  await app.close()
})

// ---------------------------------------------------------------------------
// POST /v1/apps/:appId/restore
// ---------------------------------------------------------------------------

describe("POST /v1/apps/:appId/restore", () => {
  it("clears deleted_at when owner restores a soft-deleted app", async () => {
    const deletedAt = new Date().toISOString()
    let callCount = 0
    let updatePayload: Record<string, unknown> | undefined

    vi.mocked(supabase.from).mockImplementation(() => {
      callCount++
      if (callCount === 1) {
        // Ownership + deleted_at check
        const mockSingle = vi.fn().mockResolvedValue({
          data: { id: TEST_APP_ID, creator_id: TEST_USER_ID, deleted_at: deletedAt },
          error: null,
        })
        const mockEq = vi.fn().mockReturnValue({ single: mockSingle })
        const mockSelect = vi.fn().mockReturnValue({ eq: mockEq })
        return { select: mockSelect } as never
      } else {
        // Restore update
        const mockEq = vi.fn().mockImplementation((_field: string, _value: unknown) => {
          return Promise.resolve({ error: null })
        })
        const mockUpdate = vi.fn().mockImplementation((payload: Record<string, unknown>) => {
          updatePayload = payload
          return { eq: mockEq }
        })
        return { update: mockUpdate } as never
      }
    })

    const res = await app.inject({
      method: "POST",
      url: `/v1/apps/${TEST_APP_ID}/restore`,
      headers: { "x-user-id": TEST_USER_ID },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json().success).toBe(true)
    expect(res.json().restored).toBe(true)
    expect(updatePayload).toEqual({ deleted_at: null, is_active: false })
  })

  it("returns 401 when no auth", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/v1/apps/${TEST_APP_ID}/restore`,
    })
    expect(res.statusCode).toBe(401)
  })

  it("returns 403 when caller is not the creator", async () => {
    const deletedAt = new Date().toISOString()

    const mockSingle = vi.fn().mockResolvedValue({
      data: { id: TEST_APP_ID, creator_id: OTHER_USER_ID, deleted_at: deletedAt },
      error: null,
    })
    const mockEq = vi.fn().mockReturnValue({ single: mockSingle })
    const mockSelect = vi.fn().mockReturnValue({ eq: mockEq })
    vi.mocked(supabase.from).mockReturnValue({ select: mockSelect } as never)

    const res = await app.inject({
      method: "POST",
      url: `/v1/apps/${TEST_APP_ID}/restore`,
      headers: { "x-user-id": TEST_USER_ID },
    })

    expect(res.statusCode).toBe(403)
    expect(res.json().error.code).toBe("forbidden")
  })

  it("returns 404 when app doesn't exist", async () => {
    const mockSingle = vi.fn().mockResolvedValue({
      data: null,
      error: { code: "PGRST116", message: "not found" },
    })
    const mockEq = vi.fn().mockReturnValue({ single: mockSingle })
    const mockSelect = vi.fn().mockReturnValue({ eq: mockEq })
    vi.mocked(supabase.from).mockReturnValue({ select: mockSelect } as never)

    const res = await app.inject({
      method: "POST",
      url: `/v1/apps/${TEST_APP_ID}/restore`,
      headers: { "x-user-id": TEST_USER_ID },
    })

    expect(res.statusCode).toBe(404)
    expect(res.json().error.code).toBe("not_found")
  })

  it("returns 404 when app is not deleted (nothing to restore)", async () => {
    const mockSingle = vi.fn().mockResolvedValue({
      data: { id: TEST_APP_ID, creator_id: TEST_USER_ID, deleted_at: null },
      error: null,
    })
    const mockEq = vi.fn().mockReturnValue({ single: mockSingle })
    const mockSelect = vi.fn().mockReturnValue({ eq: mockEq })
    vi.mocked(supabase.from).mockReturnValue({ select: mockSelect } as never)

    const res = await app.inject({
      method: "POST",
      url: `/v1/apps/${TEST_APP_ID}/restore`,
      headers: { "x-user-id": TEST_USER_ID },
    })

    expect(res.statusCode).toBe(404)
    expect(res.json().error.code).toBe("not_deleted")
  })

  it("succeeds even when deletion was years ago (no expiration)", async () => {
    // deleted_at set 2 years in the past
    const twoYearsAgo = new Date(Date.now() - 2 * 365 * 24 * 60 * 60 * 1000).toISOString()
    let callCount = 0
    let updatePayload: Record<string, unknown> | undefined

    vi.mocked(supabase.from).mockImplementation(() => {
      callCount++
      if (callCount === 1) {
        const mockSingle = vi.fn().mockResolvedValue({
          data: { id: TEST_APP_ID, creator_id: TEST_USER_ID, deleted_at: twoYearsAgo },
          error: null,
        })
        const mockEq = vi.fn().mockReturnValue({ single: mockSingle })
        const mockSelect = vi.fn().mockReturnValue({ eq: mockEq })
        return { select: mockSelect } as never
      } else {
        const mockEq = vi.fn().mockImplementation((_field: string, _value: unknown) => {
          return Promise.resolve({ error: null })
        })
        const mockUpdate = vi.fn().mockImplementation((payload: Record<string, unknown>) => {
          updatePayload = payload
          return { eq: mockEq }
        })
        return { update: mockUpdate } as never
      }
    })

    const res = await app.inject({
      method: "POST",
      url: `/v1/apps/${TEST_APP_ID}/restore`,
      headers: { "x-user-id": TEST_USER_ID },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json().success).toBe(true)
    expect(res.json().restored).toBe(true)
    expect(updatePayload).toEqual({ deleted_at: null, is_active: false })
  })
})
