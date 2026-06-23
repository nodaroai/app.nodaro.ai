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

import { workflowRoutes } from "../workflows.js"
import { supabase } from "../../lib/supabase.js"
import { checkIsAdmin } from "../../lib/admin-check.js"

const TEST_USER_ID = "00000000-0000-4000-8000-000000000001"

let app: FastifyInstance

/**
 * Maximally-permissive thenable supabase stub: every builder method returns the
 * same object; awaiting it resolves `result`. Lets a single object capture the
 * `.eq`/`.is`/`.not` calls for assertions regardless of chain order.
 */
function chain(result: { data: unknown; error: unknown }) {
  const obj: Record<string, unknown> = {}
  for (const m of ["select", "eq", "is", "order", "limit", "not", "in"]) {
    obj[m] = vi.fn(() => obj)
  }
  obj.then = (resolve: (v: unknown) => unknown) => Promise.resolve(result).then(resolve)
  return obj as Record<string, ReturnType<typeof vi.fn>> & { then: unknown }
}

beforeEach(async () => {
  vi.clearAllMocks()
  app = Fastify({ logger: false })
  app.addHook("preHandler", async (req) => {
    const header = req.headers["x-user-id"]
    if (header && typeof header === "string") {
      ;(req as any).userId = header
      ;(req as any).userRole = undefined
    }
  })
  await app.register(async (instance) => {
    await workflowRoutes(instance)
  })
  await app.ready()
})

afterEach(async () => {
  await app.close()
})

describe("GET /v1/workflows?viewAll=true — admin Studio all-users view", () => {
  it("returns 403 for a non-admin", async () => {
    vi.mocked(checkIsAdmin).mockResolvedValue(false)
    const res = await app.inject({
      method: "GET",
      url: "/v1/workflows?viewAll=true&studio=true",
      headers: { "x-user-id": TEST_USER_ID },
    })
    expect(res.statusCode).toBe(403)
  })

  it("for an admin: studio-filters, does NOT scope user_id, and attaches owner emails", async () => {
    vi.mocked(checkIsAdmin).mockResolvedValue(true)
    const workflowsChain = chain({
      data: [
        {
          id: "w1",
          project_id: "p1",
          user_id: "owner-1",
          name: "Studio Flow",
          thumbnail_url: null,
          created_at: "t",
          updated_at: "t",
        },
      ],
      error: null,
    })
    const profilesChain = chain({
      data: [{ id: "owner-1", email: "owner@example.com" }],
      error: null,
    })
    vi.mocked(supabase.from).mockImplementation(((table: string) =>
      table === "profiles" ? profilesChain : workflowsChain) as never)

    const res = await app.inject({
      method: "GET",
      url: "/v1/workflows?viewAll=true&studio=true",
      headers: { "x-user-id": TEST_USER_ID },
    })

    expect(res.statusCode).toBe(200)
    const body = res.json() as {
      currentUserId: string
      data: Array<{ ownerEmail: string }>
    }
    expect(body.currentUserId).toBe(TEST_USER_ID)
    expect(body.data[0]?.ownerEmail).toBe("owner@example.com")
    // Studio filter applied...
    expect(workflowsChain.not).toHaveBeenCalledWith("settings->studio", "is", null)
    // ...all-users → NOT scoped to a single user_id...
    expect(workflowsChain.eq).not.toHaveBeenCalledWith("user_id", expect.anything())
    // ...still top-level only.
    expect(workflowsChain.is).toHaveBeenCalledWith("parent_workflow_id", null)
  })
})

describe("GET /v1/workflows?studio=true — own Studio view", () => {
  it("scopes to user_id and applies the studio filter", async () => {
    const workflowsChain = chain({ data: [], error: null })
    vi.mocked(supabase.from).mockReturnValue(workflowsChain as never)

    const res = await app.inject({
      method: "GET",
      url: "/v1/workflows?studio=true",
      headers: { "x-user-id": TEST_USER_ID },
    })

    expect(res.statusCode).toBe(200)
    expect(workflowsChain.eq).toHaveBeenCalledWith("user_id", TEST_USER_ID)
    expect(workflowsChain.not).toHaveBeenCalledWith("settings->studio", "is", null)
    expect(workflowsChain.is).toHaveBeenCalledWith("parent_workflow_id", null)
  })
})
