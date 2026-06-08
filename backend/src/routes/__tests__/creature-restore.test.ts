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

import { creatureRestoreRoutes } from "../creature-restore.js"
import { supabase } from "../../lib/supabase.js"

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const TEST_USER_ID = "00000000-0000-4000-8000-000000000001"
const TEST_CREATURE_ID = "00000000-0000-4000-8000-000000000030"

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
    await creatureRestoreRoutes(instance)
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
    data: { id: TEST_CREATURE_ID, name: "Phoenix", deleted_at: "2026-05-01T00:00:00Z" },
    error: null,
  }
  const collision = opts.collision ?? { data: null, error: null }
  const update = opts.update ?? {
    data: { id: TEST_CREATURE_ID, name: "Phoenix" },
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

describe("POST /v1/creatures/:id/restore", () => {
  it("returns 401 when unauthenticated", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/v1/creatures/${TEST_CREATURE_ID}/restore`,
    })
    expect(res.statusCode).toBe(401)
    expect(res.json().error.code).toBe("unauthorized")
  })

  it("returns 400 on invalid id param", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/v1/creatures/not-a-uuid/restore`,
      headers: { "x-user-id": TEST_USER_ID },
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("validation_error")
  })

  it("happy path: archived row → 200 with restored { id, name } and UPDATE clears deleted_at", async () => {
    const stubs = mockRestoreChains({})
    vi.mocked(supabase.from).mockImplementation(stubs.next)

    const res = await app.inject({
      method: "POST",
      url: `/v1/creatures/${TEST_CREATURE_ID}/restore`,
      headers: { "x-user-id": TEST_USER_ID },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ id: TEST_CREATURE_ID, name: "Phoenix" })

    // The UPDATE must clear deleted_at.
    const updatePayload = stubs.updateFn.mock.calls[0]?.[0] as Record<string, unknown>
    expect(updatePayload.deleted_at).toBe(null)
    expect(updatePayload.name).toBe("Phoenix")

    // Scoping: the UPDATE must be keyed on both id AND user_id so a stale
    // session can't restore someone else's row.
    const updateEq = stubs.updateChain.eq as ReturnType<typeof vi.fn>
    expect(updateEq).toHaveBeenCalledWith("id", TEST_CREATURE_ID)
    expect(updateEq).toHaveBeenCalledWith("user_id", TEST_USER_ID)
  })

  it("auto-suffixes '(restored)' when an active row already owns the name", async () => {
    const stubs = mockRestoreChains({
      // Collision: another active row owns "Phoenix"
      collision: { data: { id: "other-active-id" }, error: null },
      update: { data: { id: TEST_CREATURE_ID, name: "Phoenix (restored)" }, error: null },
    })
    vi.mocked(supabase.from).mockImplementation(stubs.next)

    const res = await app.inject({
      method: "POST",
      url: `/v1/creatures/${TEST_CREATURE_ID}/restore`,
      headers: { "x-user-id": TEST_USER_ID },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ id: TEST_CREATURE_ID, name: "Phoenix (restored)" })

    // The UPDATE patch must use the suffixed name.
    const updatePayload = stubs.updateFn.mock.calls[0]?.[0] as Record<string, unknown>
    expect(updatePayload.name).toBe("Phoenix (restored)")
    expect(updatePayload.deleted_at).toBe(null)
  })

  it("returns 404 'not_found' when the creature does not exist (uniform code per Pass 10 F-90b)", async () => {
    const stubs = mockRestoreChains({
      archived: { data: null, error: { message: "no rows", code: "PGRST116" } },
    })
    vi.mocked(supabase.from).mockImplementation(stubs.next)

    const res = await app.inject({
      method: "POST",
      url: `/v1/creatures/${TEST_CREATURE_ID}/restore`,
      headers: { "x-user-id": TEST_USER_ID },
    })

    expect(res.statusCode).toBe(404)
    expect(res.json().error.code).toBe("not_found")
    // No UPDATE was issued.
    expect(stubs.updateFn).not.toHaveBeenCalled()
  })

  it("returns 404 'not_found' when the creature is cross-user (uniform code, no leak)", async () => {
    // Cross-user owner: the SELECT is scoped by .eq("user_id", userId), so a
    // cross-user lookup returns null → uniform 404 (indistinguishable from
    // "doesn't exist") per spec Pass 3 F-32.
    const stubs = mockRestoreChains({
      archived: { data: null, error: { message: "no rows", code: "PGRST116" } },
    })
    vi.mocked(supabase.from).mockImplementation(stubs.next)

    const res = await app.inject({
      method: "POST",
      url: `/v1/creatures/${TEST_CREATURE_ID}/restore`,
      headers: { "x-user-id": TEST_USER_ID },
    })

    expect(res.statusCode).toBe(404)
    expect(res.json().error.code).toBe("not_found")
  })

  it("returns 404 'not_found' when the row exists but is already active (uniform code — diverges from location's idempotent-200)", async () => {
    // Per spec Pass 10 F-90b + Pass 3 F-32, creature DELIBERATELY diverges
    // from location's idempotent-200 behaviour: an already-active row
    // returns the same uniform "not_found" 404 as missing/cross-user, so
    // the failure surface doesn't leak which IDs exist as already-active
    // vs which don't exist at all.
    const stubs = mockRestoreChains({
      archived: {
        data: { id: TEST_CREATURE_ID, name: "Phoenix", deleted_at: null },
        error: null,
      },
    })
    vi.mocked(supabase.from).mockImplementation(stubs.next)

    const res = await app.inject({
      method: "POST",
      url: `/v1/creatures/${TEST_CREATURE_ID}/restore`,
      headers: { "x-user-id": TEST_USER_ID },
    })

    expect(res.statusCode).toBe(404)
    expect(res.json().error.code).toBe("not_found")
    // No UPDATE was issued — only the initial SELECT ran.
    expect(stubs.updateFn).not.toHaveBeenCalled()
  })
})
