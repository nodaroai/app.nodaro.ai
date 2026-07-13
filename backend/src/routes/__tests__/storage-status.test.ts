import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"

// ---------------------------------------------------------------------------
// Mocks — hoisted before any route import
// ---------------------------------------------------------------------------

// vi.mock factories are hoisted above module-level consts; vi.hoisted keeps
// the fn reference initialized before the factory first runs.
const { hasCreditsMock } = vi.hoisted(() => ({ hasCreditsMock: vi.fn(() => true) }))

vi.mock("@/lib/config.js", () => ({
  config: {
    EDITION: "cloud",
    SUPABASE_URL: "https://test.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "test",
    R2_PUBLIC_URL: "https://pub-test.r2.dev",
  },
  isCloud: () => true,
  hasCredits: () => hasCreditsMock(),
  isCommunity: () => false,
  isBusiness: () => false,
  hasAdmin: () => true,
}))

vi.mock("@/utils/file-validation.js", () => ({
  checkStorageQuota: vi.fn(),
}))

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import { storageStatusRoutes } from "../storage-status.js"
import { checkStorageQuota } from "../../utils/file-validation.js"

// ---------------------------------------------------------------------------
// Test app setup
// ---------------------------------------------------------------------------

const TEST_USER_ID = "00000000-0000-4000-8000-000000000001"

let app: FastifyInstance

beforeEach(async () => {
  vi.clearAllMocks()
  hasCreditsMock.mockReturnValue(true)

  app = Fastify({ logger: false })

  // Bypass auth — set userId from query for protected routes
  app.addHook("preHandler", async (req) => {
    const query = req.query as Record<string, unknown> | undefined
    const userId = query?.userId
    if (userId && typeof userId === "string") {
      req.userId = userId
    }
  })

  await app.register(async (instance) => {
    await storageStatusRoutes(instance)
  })

  await app.ready()
})

afterEach(async () => {
  await app.close()
})

// ---------------------------------------------------------------------------
// Tests — GET /v1/storage/status
// ---------------------------------------------------------------------------

describe("GET /v1/storage/status", () => {
  it("returns 401 when no auth", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/storage/status" })

    expect(res.statusCode).toBe(401)
    expect(res.json().error.code).toBe("unauthorized")
    expect(vi.mocked(checkStorageQuota)).not.toHaveBeenCalled()
  })

  it("returns the caller's usedBytes and resolved limitBytes as numbers", async () => {
    vi.mocked(checkStorageQuota).mockResolvedValue({
      allowed: true,
      usedBytes: 123_456_789,
      quotaBytes: 1_073_741_824,
      remainingBytes: 950_284_035,
      tier: "free",
    })

    const res = await app.inject({
      method: "GET",
      url: `/v1/storage/status?userId=${TEST_USER_ID}`,
    })

    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body).toEqual({ usedBytes: 123_456_789, limitBytes: 1_073_741_824 })
    expect(typeof body.usedBytes).toBe("number")
    expect(typeof body.limitBytes).toBe("number")
    // Pure read — checked against the exact quota source /v1/upload uses.
    expect(vi.mocked(checkStorageQuota)).toHaveBeenCalledWith(TEST_USER_ID, 0)
  })

  it("returns numbers even when the caller is already over quota", async () => {
    // checkStorageQuota(userId, 0) reports allowed:false when used > quota —
    // the status endpoint must surface the numbers, not fail.
    vi.mocked(checkStorageQuota).mockResolvedValue({
      allowed: false,
      error: "Storage quota exceeded",
      usedBytes: 2_000_000_000,
      quotaBytes: 1_073_741_824,
      remainingBytes: 0,
      tier: "free",
    })

    const res = await app.inject({
      method: "GET",
      url: `/v1/storage/status?userId=${TEST_USER_ID}`,
    })

    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ usedBytes: 2_000_000_000, limitBytes: 1_073_741_824 })
  })

  it("self-hosted (no credits): reports zero usage and a null (unlimited) limit", async () => {
    hasCreditsMock.mockReturnValue(false)

    const res = await app.inject({
      method: "GET",
      url: `/v1/storage/status?userId=${TEST_USER_ID}`,
    })

    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ usedBytes: 0, limitBytes: null })
    expect(vi.mocked(checkStorageQuota)).not.toHaveBeenCalled()
  })

  it("500s when the profile lookup yields no numbers", async () => {
    vi.mocked(checkStorageQuota).mockResolvedValue({
      allowed: false,
      error: "Could not verify storage quota: user profile not found",
    })

    const res = await app.inject({
      method: "GET",
      url: `/v1/storage/status?userId=${TEST_USER_ID}`,
    })

    expect(res.statusCode).toBe(500)
    expect(res.json().error.code).toBe("internal_error")
  })
})
