import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"

vi.mock("@/lib/supabase.js", () => {
  const mockFrom = vi.fn()
  return { supabase: { from: mockFrom } }
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

vi.mock("@/ee/middleware/require-admin.js", () => ({
  requireAdmin: async () => {},
}))

import { adminClientAppsRoutes } from "../admin-client-apps.js"
import { supabase } from "../../../lib/supabase.js"

const TEST_USER_ID = "00000000-0000-4000-8000-000000000001"

let app: FastifyInstance

/**
 * Chainable AND awaitable Supabase builder stub: every method returns the same
 * object, and awaiting it resolves `result` (with `count` for HEAD counts).
 */
function chain(result: { data?: unknown; error?: unknown; count?: number | null }) {
  const obj: Record<string, unknown> = {}
  for (const m of ["select", "eq", "order", "update", "single", "maybeSingle"]) {
    obj[m] = vi.fn(() => obj)
  }
  obj.then = (resolve: (v: unknown) => unknown) =>
    Promise.resolve({ error: null, ...result }).then(resolve)
  return obj as Record<string, ReturnType<typeof vi.fn>> & { then: unknown }
}

beforeEach(async () => {
  vi.clearAllMocks()
  app = Fastify({ logger: false })
  app.addHook("preHandler", async (req) => {
    const header = req.headers["x-user-id"]
    if (header && typeof header === "string") {
      req.userId = header
    }
  })
  await app.register(async (instance) => {
    await adminClientAppsRoutes(instance)
  })
  await app.ready()
})

afterEach(async () => {
  await app.close()
})

describe("GET /v1/admin/client-apps", () => {
  it("lists the registry with each app's workflow count", async () => {
    const appsChain = chain({
      data: [
        { slug: "studio", name: "Studio", workflows_listed: true, created_at: "t" },
        {
          slug: "voice-changer-pro",
          name: "Voice Changer Pro",
          workflows_listed: false,
          created_at: "t",
        },
      ],
    })
    // One HEAD count per app; both land on `workflows`.
    const countsChain = chain({ count: 7 })
    vi.mocked(supabase.from).mockImplementation(((table: string) =>
      table === "client_apps" ? appsChain : countsChain) as never)

    const res = await app.inject({
      method: "GET",
      url: "/v1/admin/client-apps",
      headers: { "x-user-id": TEST_USER_ID },
    })

    expect(res.statusCode).toBe(200)
    const body = res.json() as {
      data: Array<{ slug: string; workflowsListed: boolean; workflowCount: number | null }>
    }
    expect(body.data).toHaveLength(2)
    expect(body.data[0]).toMatchObject({
      slug: "studio",
      workflowsListed: true,
      workflowCount: 7,
    })
    // The registry is what tells the operator vcp's rows are deliberately hidden.
    expect(body.data[1]).toMatchObject({
      slug: "voice-changer-pro",
      workflowsListed: false,
      workflowCount: 7,
    })
    expect(countsChain.eq).toHaveBeenCalledWith("app_slug", "studio")
    expect(countsChain.eq).toHaveBeenCalledWith("app_slug", "voice-changer-pro")
  })

  it("reports a null count rather than a misleading 0 when the count fails", async () => {
    const appsChain = chain({
      data: [{ slug: "studio", name: "Studio", workflows_listed: true, created_at: "t" }],
    })
    const countsChain = chain({ count: null, error: { message: "boom" } })
    vi.mocked(supabase.from).mockImplementation(((table: string) =>
      table === "client_apps" ? appsChain : countsChain) as never)

    const res = await app.inject({
      method: "GET",
      url: "/v1/admin/client-apps",
      headers: { "x-user-id": TEST_USER_ID },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json().data[0].workflowCount).toBeNull()
  })
})

describe("PATCH /v1/admin/client-apps/:slug — the workflows_listed toggle", () => {
  it("flips workflows_listed for the app", async () => {
    const appsChain = chain({
      data: { slug: "voice-changer-pro", name: "Voice Changer Pro", workflows_listed: true },
    })
    vi.mocked(supabase.from).mockReturnValue(appsChain as never)

    const res = await app.inject({
      method: "PATCH",
      url: "/v1/admin/client-apps/voice-changer-pro",
      headers: { "x-user-id": TEST_USER_ID },
      payload: { workflowsListed: true },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json().data).toMatchObject({
      slug: "voice-changer-pro",
      workflowsListed: true,
    })
    // One UPDATE re-classifies every one of the app's workflows — the point of
    // holding the flag on the app rather than on each row.
    expect(appsChain.update).toHaveBeenCalledWith({ workflows_listed: true })
    expect(appsChain.eq).toHaveBeenCalledWith("slug", "voice-changer-pro")
  })

  it("can hide a listed app again", async () => {
    const appsChain = chain({
      data: { slug: "studio", name: "Studio", workflows_listed: false },
    })
    vi.mocked(supabase.from).mockReturnValue(appsChain as never)

    const res = await app.inject({
      method: "PATCH",
      url: "/v1/admin/client-apps/studio",
      headers: { "x-user-id": TEST_USER_ID },
      payload: { workflowsListed: false },
    })

    expect(res.statusCode).toBe(200)
    expect(appsChain.update).toHaveBeenCalledWith({ workflows_listed: false })
    expect(res.json().data.workflowsListed).toBe(false)
  })

  it("404s on an unregistered slug instead of creating a registry entry", async () => {
    const appsChain = chain({ data: null })
    vi.mocked(supabase.from).mockReturnValue(appsChain as never)

    const res = await app.inject({
      method: "PATCH",
      url: "/v1/admin/client-apps/not-a-real-app",
      headers: { "x-user-id": TEST_USER_ID },
      payload: { workflowsListed: true },
    })

    expect(res.statusCode).toBe(404)
  })

  it("400s on a non-boolean workflowsListed", async () => {
    vi.mocked(supabase.from).mockReturnValue(chain({ data: null }) as never)

    const res = await app.inject({
      method: "PATCH",
      url: "/v1/admin/client-apps/studio",
      headers: { "x-user-id": TEST_USER_ID },
      payload: { workflowsListed: "yes" },
    })

    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("validation_error")
  })
})
