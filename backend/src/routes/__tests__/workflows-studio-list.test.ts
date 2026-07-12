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
  for (const m of [
    "select",
    "eq",
    "is",
    "order",
    "limit",
    "not",
    "in",
    "or",
    "insert",
    "update",
    "single",
    "maybeSingle",
  ]) {
    obj[m] = vi.fn(() => obj)
  }
  // Thenable: `await chain.select(...).maybeSingle()` resolves to `result`.
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
    // Studio filter applied — now on app_slug, not studio's private settings.
    expect(workflowsChain.eq).toHaveBeenCalledWith("app_slug", "studio")
    expect(workflowsChain.not).not.toHaveBeenCalledWith("settings->studio", "is", null)
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
    // `?studio=true` is now an alias for `?app=studio`.
    expect(workflowsChain.eq).toHaveBeenCalledWith("app_slug", "studio")
    expect(workflowsChain.not).not.toHaveBeenCalledWith("settings->studio", "is", null)
    expect(workflowsChain.is).toHaveBeenCalledWith("parent_workflow_id", null)
  })
})

describe("GET /v1/workflows?app=<slug> — client-app scope", () => {
  it("scopes the list to that app's workflows", async () => {
    const workflowsChain = chain({ data: [], error: null })
    vi.mocked(supabase.from).mockReturnValue(workflowsChain as never)

    const res = await app.inject({
      method: "GET",
      url: "/v1/workflows?app=voice-changer-pro",
      headers: { "x-user-id": TEST_USER_ID },
    })

    expect(res.statusCode).toBe(200)
    expect(workflowsChain.eq).toHaveBeenCalledWith("app_slug", "voice-changer-pro")
    expect(workflowsChain.eq).toHaveBeenCalledWith("user_id", TEST_USER_ID)
  })

  it("an explicit ?app= wins over the legacy ?studio=true alias", async () => {
    const workflowsChain = chain({ data: [], error: null })
    vi.mocked(supabase.from).mockReturnValue(workflowsChain as never)

    await app.inject({
      method: "GET",
      url: "/v1/workflows?app=voice-changer-pro&studio=true",
      headers: { "x-user-id": TEST_USER_ID },
    })

    expect(workflowsChain.eq).toHaveBeenCalledWith("app_slug", "voice-changer-pro")
    expect(workflowsChain.eq).not.toHaveBeenCalledWith("app_slug", "studio")
  })

  /**
   * REGRESSION GUARD — do not "finish the job" by making the default native-only.
   * voice-changer-pro lists its own conversions through this call with no param;
   * scoping the default would blank its conversion list in production. The flip
   * is Phase 2, gated on an SDK release that sends `?app=voice-changer-pro`.
   */
  it("with NO app param, returns everything the caller owns (default unchanged)", async () => {
    const workflowsChain = chain({ data: [], error: null })
    vi.mocked(supabase.from).mockReturnValue(workflowsChain as never)

    const res = await app.inject({
      method: "GET",
      url: "/v1/workflows",
      headers: { "x-user-id": TEST_USER_ID },
    })

    expect(res.statusCode).toBe(200)
    expect(workflowsChain.eq).toHaveBeenCalledWith("user_id", TEST_USER_ID)
    // No app_slug filter of ANY kind — not a scope, not a visibility rule.
    expect(workflowsChain.eq).not.toHaveBeenCalledWith("app_slug", expect.anything())
    expect(workflowsChain.is).not.toHaveBeenCalledWith("app_slug", null)
    expect(workflowsChain.or).not.toHaveBeenCalled()
  })
})

describe("POST /v1/workflows — appSlug validation", () => {
  /** Registry lookup hits `client_apps`; the insert hits `workflows`. */
  function mockRegistry(opts: { known: boolean }) {
    const clientAppsChain = chain({
      data: opts.known ? { slug: "voice-changer-pro" } : null,
      error: null,
    })
    const workflowsChain = chain({
      data: {
        id: "w1",
        project_id: "p1",
        user_id: TEST_USER_ID,
        name: "Conversion",
        app_slug: opts.known ? "voice-changer-pro" : null,
        settings: {},
        nodes: [],
        edges: [],
      },
      error: null,
    })
    const projectsChain = chain({ data: { id: "p1" }, error: null })
    vi.mocked(supabase.from).mockImplementation(((table: string) => {
      if (table === "client_apps") return clientAppsChain
      if (table === "projects") return projectsChain
      return workflowsChain
    }) as never)
    return { clientAppsChain, workflowsChain }
  }

  const PROJECT_ID = "00000000-0000-4000-8000-000000000002"

  it("persists a known appSlug to workflows.app_slug", async () => {
    const { workflowsChain, clientAppsChain } = mockRegistry({ known: true })

    const res = await app.inject({
      method: "POST",
      url: "/v1/workflows",
      headers: { "x-user-id": TEST_USER_ID },
      payload: { name: "Conversion", projectId: PROJECT_ID, appSlug: "voice-changer-pro" },
    })

    expect(res.statusCode).toBe(201)
    expect(clientAppsChain.eq).toHaveBeenCalledWith("slug", "voice-changer-pro")
    expect(workflowsChain.insert).toHaveBeenCalledWith(
      expect.objectContaining({ app_slug: "voice-changer-pro" }),
    )
  })

  it("rejects an unknown appSlug with a 400", async () => {
    mockRegistry({ known: false })

    const res = await app.inject({
      method: "POST",
      url: "/v1/workflows",
      headers: { "x-user-id": TEST_USER_ID },
      payload: { name: "Junk", projectId: PROJECT_ID, appSlug: "not-a-real-app" },
    })

    // Never silently store an unregistered slug: the visibility rule fails
    // closed, so the caller would get a workflow they can never see.
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("validation_error")
  })

  it("omitting appSlug creates a native workflow (app_slug null)", async () => {
    const { workflowsChain } = mockRegistry({ known: true })

    const res = await app.inject({
      method: "POST",
      url: "/v1/workflows",
      headers: { "x-user-id": TEST_USER_ID },
      payload: { name: "Native", projectId: PROJECT_ID },
    })

    expect(res.statusCode).toBe(201)
    expect(workflowsChain.insert).toHaveBeenCalledWith(
      expect.objectContaining({ app_slug: null }),
    )
  })
})
