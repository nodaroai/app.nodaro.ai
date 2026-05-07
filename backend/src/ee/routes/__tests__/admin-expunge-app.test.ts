import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"

// ---------------------------------------------------------------------------
// Mocks — hoisted before any route import
// ---------------------------------------------------------------------------

vi.mock("@/lib/supabase.js", () => {
  const mockFrom = vi.fn()
  const mockRpc = vi.fn()
  return { supabase: { from: mockFrom, rpc: mockRpc } }
})

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

vi.mock("@/lib/admin-check.js", () => ({
  warmAdminCache: vi.fn(),
  checkIsAdmin: vi.fn().mockResolvedValue(true),
}))

// Mock requireAdmin as passthrough — admin check tested separately per-test
vi.mock("@/ee/middleware/require-admin.js", () => ({
  requireAdmin: vi.fn(async () => {}),
}))

vi.mock("@/lib/collect-app-r2-keys.js", () => ({
  collectAppR2Keys: vi.fn().mockResolvedValue(["key1", "key2", "key3"]),
}))

vi.mock("@/lib/storage.js", () => ({
  batchDeleteFromR2: vi.fn().mockResolvedValue({ deleted: 3, errors: 0 }),
}))

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import { adminRoutes } from "../admin.js"
import { supabase } from "../../../lib/supabase.js"
import { requireAdmin } from "../../middleware/require-admin.js"
import { collectAppR2Keys } from "../../../lib/collect-app-r2-keys.js"
import { batchDeleteFromR2 } from "../../../lib/storage.js"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TEST_USER_ID = "00000000-0000-4000-8000-000000000001"
const TEST_APP_ID = "00000000-0000-4000-8000-000000000099"
const TEST_REASON = "GDPR right-to-erasure request from user 12345"

const fakeApp = {
  id: TEST_APP_ID,
  slug: "my-test-app",
  deleted_at: "2026-05-01T10:00:00.000Z",
}

let app: FastifyInstance

beforeEach(async () => {
  vi.clearAllMocks()

  // Reset requireAdmin to passthrough for most tests
  vi.mocked(requireAdmin).mockImplementation(async () => {})

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
    await adminRoutes(instance)
  })

  await app.ready()
})

afterEach(async () => {
  await app.close()
})

// ---------------------------------------------------------------------------
// DELETE /v1/admin/apps/:appId/expunge
// ---------------------------------------------------------------------------

describe("DELETE /v1/admin/apps/:appId/expunge", () => {
  it("returns 403 when caller is not admin", async () => {
    vi.mocked(requireAdmin).mockImplementationOnce(async (_req, reply) => {
      reply.status(403).send({ error: { code: "forbidden", message: "Admin access required" } })
    })

    const res = await app.inject({
      method: "DELETE",
      url: `/v1/admin/apps/${TEST_APP_ID}/expunge`,
      headers: { "x-user-id": TEST_USER_ID },
      payload: { reason: TEST_REASON },
    })

    expect(res.statusCode).toBe(403)
    expect(res.json().error.code).toBe("forbidden")
  })

  it("returns 400 when reason is missing", async () => {
    const res = await app.inject({
      method: "DELETE",
      url: `/v1/admin/apps/${TEST_APP_ID}/expunge`,
      headers: { "x-user-id": TEST_USER_ID },
      payload: {},
    })

    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("reason_required")
  })

  it("returns 400 when reason is too short", async () => {
    const res = await app.inject({
      method: "DELETE",
      url: `/v1/admin/apps/${TEST_APP_ID}/expunge`,
      headers: { "x-user-id": TEST_USER_ID },
      payload: { reason: "too short" },
    })

    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("reason_required")
  })

  it("returns 404 when app does not exist", async () => {
    const mockSingle = vi.fn().mockResolvedValue({ data: null, error: { message: "not found" } })
    const mockEq = vi.fn().mockReturnValue({ single: mockSingle })
    const mockSelect = vi.fn().mockReturnValue({ eq: mockEq })
    vi.mocked(supabase.from).mockReturnValue({ select: mockSelect } as never)

    const res = await app.inject({
      method: "DELETE",
      url: `/v1/admin/apps/${TEST_APP_ID}/expunge`,
      headers: { "x-user-id": TEST_USER_ID },
      payload: { reason: TEST_REASON },
    })

    expect(res.statusCode).toBe(404)
    expect(res.json().error.code).toBe("not_found")
  })

  it("returns 400 when app is not soft-deleted", async () => {
    const liveApp = { ...fakeApp, deleted_at: null }
    const mockSingle = vi.fn().mockResolvedValue({ data: liveApp, error: null })
    const mockEq = vi.fn().mockReturnValue({ single: mockSingle })
    const mockSelect = vi.fn().mockReturnValue({ eq: mockEq })
    vi.mocked(supabase.from).mockReturnValue({ select: mockSelect } as never)

    const res = await app.inject({
      method: "DELETE",
      url: `/v1/admin/apps/${TEST_APP_ID}/expunge`,
      headers: { "x-user-id": TEST_USER_ID },
      payload: { reason: TEST_REASON },
    })

    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("app_not_soft_deleted")
  })

  it("happy path: snapshots, redacts runs, deletes app, queues R2, audit logs", async () => {
    // Track all supabase.from() calls by table name
    const fromCalls: Record<string, ReturnType<typeof vi.fn>> = {}

    // Capture the audit insert mock at the outer scope so we can assert on it
    const auditInsertMock = vi.fn().mockResolvedValue({ error: null })

    vi.mocked(supabase.from).mockImplementation((table: string) => {
      if (table === "published_apps") {
        // First call: SELECT (single)
        // Second call: DELETE
        if (!fromCalls["published_apps_select"]) {
          const mockSingle = vi.fn().mockResolvedValue({ data: fakeApp, error: null })
          const mockEq = vi.fn().mockReturnValue({ single: mockSingle })
          const mockSelect = vi.fn().mockReturnValue({ eq: mockEq })
          const mock = { select: mockSelect }
          fromCalls["published_apps_select"] = vi.fn().mockReturnValue(mock)
          return mock as never
        } else {
          // Second call: DELETE
          const mockEq = vi.fn().mockResolvedValue({ error: null })
          const mock = { delete: vi.fn().mockReturnValue({ eq: mockEq }) }
          return mock as never
        }
      }
      if (table === "app_runs") {
        const mockEq = vi.fn().mockResolvedValue({ error: null })
        const mockUpdate = vi.fn().mockReturnValue({ eq: mockEq })
        return { update: mockUpdate } as never
      }
      if (table === "admin_actions") {
        return { insert: auditInsertMock } as never
      }
      return {} as never
    })

    // Mock RPC
    vi.mocked(supabase.rpc).mockResolvedValue({ data: null, error: null } as never)

    // collectAppR2Keys returns 3 keys (already mocked globally)
    // batchDeleteFromR2 returns { deleted: 3, errors: 0 } (already mocked globally)

    const res = await app.inject({
      method: "DELETE",
      url: `/v1/admin/apps/${TEST_APP_ID}/expunge`,
      headers: { "x-user-id": TEST_USER_ID },
      payload: { reason: TEST_REASON },
    })

    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.success).toBe(true)
    expect(body.r2KeysCollected).toBe(3)
    expect(body.r2KeysDeleted).toBe(3)
    expect(body.r2Errors).toBe(0)
    expect(body.expungedAt).toBeTruthy()

    // Verify RPC called with correct args
    expect(supabase.rpc).toHaveBeenCalledWith("expunge_app_snapshots", { p_app_id: TEST_APP_ID })

    // Verify collectAppR2Keys called with appId
    expect(collectAppR2Keys).toHaveBeenCalledWith(TEST_APP_ID)

    // Verify batchDeleteFromR2 called with the collected keys
    expect(batchDeleteFromR2).toHaveBeenCalledWith(["key1", "key2", "key3"])

    // Verify supabase.from was called with expected tables
    const fromArgs = vi.mocked(supabase.from).mock.calls.map((c) => c[0])
    expect(fromArgs).toContain("published_apps")
    expect(fromArgs).toContain("app_runs")
    expect(fromArgs).toContain("admin_actions")

    // Verify audit log insert was called with the correct payload
    expect(auditInsertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        admin_user_id: TEST_USER_ID,
        action: "expunge_app",
        target_type: "published_app",
        target_id: TEST_APP_ID,
        reason: TEST_REASON,
        payload: expect.objectContaining({ slug: fakeApp.slug }),
      }),
    )
  })
})
