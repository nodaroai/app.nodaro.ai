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

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import { locationRestoreRoutes } from "../location-restore.js"
import { supabase } from "../../lib/supabase.js"

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const TEST_USER_ID = "00000000-0000-4000-8000-000000000001"
const TEST_LOCATION_ID = "00000000-0000-4000-8000-000000000030"

// ---------------------------------------------------------------------------
// App harness
// ---------------------------------------------------------------------------

let app: FastifyInstance

beforeEach(async () => {
  vi.clearAllMocks()
  app = Fastify({ logger: false })
  // Simulate auth middleware: set req.userId from X-User-Id header.
  app.addHook("preHandler", async (req) => {
    const header = req.headers["x-user-id"]
    if (typeof header === "string") {
      req.userId = header
    }
  })
  await app.register(async (instance) => {
    await locationRestoreRoutes(instance)
  })
  await app.ready()
})

afterEach(async () => {
  await app.close()
})

// ---------------------------------------------------------------------------
// Test helpers — chain builders mirroring the restore handler's call sequence
// ---------------------------------------------------------------------------

/**
 * Mock chain builder for the restore route.
 *
 * Call order in the handler:
 *   1. SELECT(id, name, deleted_at) → single() — fetch archived row
 *   2. SELECT(id) → ilike() / maybeSingle() — name-collision check (skipped on no-op)
 *   3. UPDATE(deleted_at=null, name=…) → single() — un-archive
 */
function mockRestoreChains(opts: {
  archived?: { data: unknown; error: unknown }
  collision?: { data: unknown; error: unknown }
  update?: { data: unknown; error: unknown }
}) {
  const archived = opts.archived ?? {
    data: { id: TEST_LOCATION_ID, name: "Forest", deleted_at: "2026-05-01T00:00:00Z" },
    error: null,
  }
  const collision = opts.collision ?? { data: null, error: null }
  const update = opts.update ?? {
    data: { id: TEST_LOCATION_ID, name: "Forest" },
    error: null,
  }

  const archivedChain: Record<string, unknown> = {
    eq: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue(archived),
  }
  const archivedSelect = vi.fn().mockReturnValue(archivedChain)

  const collisionChain: Record<string, unknown> = {
    eq: vi.fn().mockReturnThis(),
    is: vi.fn().mockReturnThis(),
    ilike: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue(collision),
  }
  const collisionSelect = vi.fn().mockReturnValue(collisionChain)

  const updateChain: Record<string, unknown> = {
    eq: vi.fn().mockReturnThis(),
    select: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue(update),
  }
  const updateFn = vi.fn().mockReturnValue(updateChain)

  let call = 0
  function next() {
    const c = call++
    if (c === 0) return { select: archivedSelect } as never
    if (c === 1) return { select: collisionSelect } as never
    return { update: updateFn } as never
  }
  return { next, archivedChain, collisionChain, updateChain, updateFn }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("POST /v1/locations/:id/restore", () => {
  it("returns 401 when unauthenticated", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/v1/locations/${TEST_LOCATION_ID}/restore`,
    })
    expect(res.statusCode).toBe(401)
    expect(res.json().error.code).toBe("unauthorized")
  })

  it("returns 200 and un-archives the row (clears deleted_at)", async () => {
    const stubs = mockRestoreChains({})
    vi.mocked(supabase.from).mockImplementation(stubs.next)

    const res = await app.inject({
      method: "POST",
      url: `/v1/locations/${TEST_LOCATION_ID}/restore`,
      headers: { "x-user-id": TEST_USER_ID },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ id: TEST_LOCATION_ID, name: "Forest" })

    // The UPDATE must clear deleted_at.
    const updatePayload = stubs.updateFn.mock.calls[0]?.[0] as Record<string, unknown>
    expect(updatePayload.deleted_at).toBe(null)
    expect(updatePayload.name).toBe("Forest")

    // Scoping: the UPDATE must be keyed on both id AND user_id so a stale
    // session can't restore someone else's row.
    const updateEq = stubs.updateChain.eq as ReturnType<typeof vi.fn>
    expect(updateEq).toHaveBeenCalledWith("id", TEST_LOCATION_ID)
    expect(updateEq).toHaveBeenCalledWith("user_id", TEST_USER_ID)
  })

  it("auto-suffixes '(restored)' when an active row already owns the name", async () => {
    const stubs = mockRestoreChains({
      // Collision: another active row owns "Forest"
      collision: { data: { id: "other-active-id" }, error: null },
      update: { data: { id: TEST_LOCATION_ID, name: "Forest (restored)" }, error: null },
    })
    vi.mocked(supabase.from).mockImplementation(stubs.next)

    const res = await app.inject({
      method: "POST",
      url: `/v1/locations/${TEST_LOCATION_ID}/restore`,
      headers: { "x-user-id": TEST_USER_ID },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ id: TEST_LOCATION_ID, name: "Forest (restored)" })

    // The UPDATE patch must use the suffixed name.
    const updatePayload = stubs.updateFn.mock.calls[0]?.[0] as Record<string, unknown>
    expect(updatePayload.name).toBe("Forest (restored)")
    expect(updatePayload.deleted_at).toBe(null)
  })

  it("returns 404 when the location does not exist or is owned by another user", async () => {
    const stubs = mockRestoreChains({
      archived: { data: null, error: { message: "no rows", code: "PGRST116" } },
    })
    vi.mocked(supabase.from).mockImplementation(stubs.next)

    const res = await app.inject({
      method: "POST",
      url: `/v1/locations/${TEST_LOCATION_ID}/restore`,
      headers: { "x-user-id": TEST_USER_ID },
    })

    expect(res.statusCode).toBe(404)
    expect(res.json().error.code).toBe("location_not_found")
  })

  it("is idempotent on an already-active row (no UPDATE issued)", async () => {
    // deleted_at: null → row is already active; route returns the existing
    // id/name without re-running the UPDATE.
    const stubs = mockRestoreChains({
      archived: {
        data: { id: TEST_LOCATION_ID, name: "Forest", deleted_at: null },
        error: null,
      },
    })
    vi.mocked(supabase.from).mockImplementation(stubs.next)

    const res = await app.inject({
      method: "POST",
      url: `/v1/locations/${TEST_LOCATION_ID}/restore`,
      headers: { "x-user-id": TEST_USER_ID },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ id: TEST_LOCATION_ID, name: "Forest" })
    // No UPDATE was issued — only the initial SELECT ran.
    expect(stubs.updateFn).not.toHaveBeenCalled()
  })
})
