import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"

/**
 * A published app on a deployment that does not allow public outputs
 * (`outputs.allowPublic: false`, decided 2026-11-11).
 *
 * There an app is its creator's alone: its page (an admin keeps a preview),
 * its social card and its embed answer everyone else exactly as for an app
 * that does not exist, and starting, restoring, continuing or re-rendering a
 * run of someone else's app is refused the same way. The page is asked BEFORE
 * the in-memory cache (which holds one answer for every caller), and the
 * creator's answer is never stored by a shared cache. A runner's own past runs
 * stay readable. With public outputs allowed every answer, headers included,
 * is what it was.
 */

const CREATOR = "00000000-0000-4000-8000-0000000000c1"
const OTHER = "00000000-0000-4000-8000-0000000000a1"
const ADMIN = "00000000-0000-4000-8000-0000000000ad"
const SLUG = "zebrify"
const APP_ID = "00000000-0000-4000-8000-000000000010"
const WORKFLOW_ID = "00000000-0000-4000-8000-000000000020"
const RUN_ID = "00000000-0000-4000-8000-000000000040"
const EXEC_ID = "00000000-0000-4000-8000-000000000030"

const h = vi.hoisted(() => ({
  rows: new Map<string, unknown[]>(),
  tables: [] as string[],
  checkIsAdmin: vi.fn(),
}))

vi.mock("@/lib/supabase.js", () => {
  function chain(table: string) {
    const rows = h.rows.get(table) ?? []
    const proxy: Record<string, unknown> = new Proxy(
      {},
      {
        get(_target, prop) {
          if (prop === "then") return (resolve: (v: unknown) => void) => resolve({ data: rows, error: null })
          if (prop === "single" || prop === "maybeSingle") {
            return async () => (rows[0] ? { data: rows[0], error: null } : { data: null, error: { code: "PGRST116", message: "none" } })
          }
          return () => proxy
        },
      },
    )
    return proxy
  }
  return {
    supabase: {
      from: vi.fn((table: string) => {
        h.tables.push(table)
        return chain(table)
      }),
      rpc: vi.fn(),
    },
  }
})
vi.mock("@/lib/config.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/config.js")>()),
  isCloud: () => true,
  isBusiness: () => false,
  hasAdmin: () => true,
  hasCredits: () => true,
}))
vi.mock("@/lib/admin-check.js", () => ({ warmAdminCache: vi.fn(), checkIsAdmin: h.checkIsAdmin }))
vi.mock("@/lib/access-blocks.js", () => ({ isUserBlocked: vi.fn().mockResolvedValue(false) }))
vi.mock("@/lib/orchestration-queue.js", () => ({ orchestrationQueue: { add: vi.fn().mockResolvedValue({}) } }))
vi.mock("@/middleware/credit-guard.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/middleware/credit-guard.js")>()),
  resolveWebSurfaceFlag: vi.fn().mockResolvedValue(false),
}))
vi.mock("@/lib/private-plugins/edit-plan-per-minute.js", () => ({ editPlanPerMinuteActive: async () => false }))

import { appRunnerRoutes, invalidateAppCache } from "../app-runner.js"
import { appRunResumeRoutes } from "../app-run-resume.js"
import { appRenderFinalRoutes } from "../app-render-final.js"
import { ogTagsRoutes } from "../og-tags.js"
import { embedRoutes } from "../embed.js"
import { __resetSurfaceProfileCacheForTests } from "../../lib/surface-profile.js"

const APP_ROW = {
  id: APP_ID,
  slug: SLUG,
  name: "Zebrify",
  description: "Dress a subject as a zebra",
  icon_url: "https://cdn.example/zebra.png",
  version: 1,
  snapshot_nodes: [{ id: "n1", type: "generate-image", data: { prompt: "the creator's secret prompt" } }],
  snapshot_edges: [],
  snapshot_settings: {},
  estimated_credits: 10,
  base_estimated_credits: 10,
  creator_id: CREATOR,
  max_runs_per_user_per_day: null,
  thumbnail_node_id: null,
  supports_remix: false,
  created_at: "2026-01-01T00:00:00Z",
  workflow_id: WORKFLOW_ID,
  monetization_enabled: false,
  monetization_flat_fee: 0,
  monetization_percent: 0,
  publish_type: "app",
  is_active: true,
  is_embeddable: true,
  allowed_origins: ["https://partner.example"],
  preview_media_url: null,
}

function runRow(runnerId: string) {
  return {
    id: RUN_ID,
    app_id: APP_ID,
    runner_id: runnerId,
    execution_id: EXEC_ID,
    node_states: null,
    published_apps: { creator_id: CREATOR, version: 1, workflow_id: WORKFLOW_ID },
  }
}

function setProfile(profile: Record<string, unknown> | null) {
  if (profile) process.env.NODARO_SURFACE_PROFILE = JSON.stringify(profile)
  else delete process.env.NODARO_SURFACE_PROFILE
  __resetSurfaceProfileCacheForTests()
}

let app: FastifyInstance

beforeEach(async () => {
  vi.clearAllMocks()
  invalidateAppCache(SLUG)
  h.tables = []
  h.rows = new Map<string, unknown[]>([["published_apps", [APP_ROW]]])
  h.checkIsAdmin.mockImplementation(async (userId: string) => userId === ADMIN)
  setProfile({ outputs: { allowPublic: false } })
  app = Fastify({ logger: false })
  app.addHook("preHandler", async (req) => {
    const header = req.headers["x-user-id"]
    if (typeof header === "string") {
      req.userId = header
      req.authKind = "jwt"
    }
  })
  await app.register(async (i) => {
    await appRunnerRoutes(i)
    await appRunResumeRoutes(i)
    await appRenderFinalRoutes(i)
    await ogTagsRoutes(i)
    await embedRoutes(i)
  })
  await app.ready()
})

afterEach(async () => {
  await app.close()
  setProfile(null)
})

const APP_NOT_FOUND = { error: { code: "not_found", message: "App not found" } }
const as = (userId?: string) => (userId ? { "x-user-id": userId } : {})
const page = (userId?: string) => app.inject({ method: "GET", url: `/v1/app/${SLUG}`, headers: as(userId) })
const card = (userId?: string) => app.inject({ method: "GET", url: `/og/app/${SLUG}`, headers: as(userId) })
const embed = (userId?: string) => app.inject({ method: "GET", url: `/v1/embed/${SLUG}`, headers: as(userId) })

/** The answer each read gives for a slug that matches no app at all. */
async function missing(read: () => Promise<{ statusCode: number; body: string; headers: Record<string, unknown> }>) {
  const kept = h.rows.get("published_apps")
  h.rows.set("published_apps", [])
  const res = await read()
  h.rows.set("published_apps", kept ?? [])
  return res
}

const SIGNED_OUT_AND_OTHER = [
  ["a signed-out visitor", undefined],
  ["another signed-in user", OTHER],
] as const

describe("GET /v1/app/:slug with outputs.allowPublic false", () => {
  it.each(SIGNED_OUT_AND_OTHER)("%s gets exactly the answer of an app that does not exist", async (_who, userId) => {
    const none = await missing(() => page(userId))
    const res = await page(userId)
    expect(res.statusCode).toBe(404)
    expect(res.json()).toEqual(APP_NOT_FOUND)
    expect(res.body).toBe(none.body)
    expect(res.headers["cache-control"]).toBe(none.headers["cache-control"])
    expect(res.body).not.toContain("secret prompt")
  })

  it("the creator reads their own page, never stored by a shared cache", async () => {
    const res = await page(CREATOR)
    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({ id: APP_ID, name: "Zebrify", creatorId: CREATOR })
    expect(res.headers["cache-control"]).toBe("private, no-store")
    expect(res.headers["vary"]).toBe("Authorization")
  })

  it("an admin keeps a preview, as on a template's page", async () => {
    const res = await page(ADMIN)
    expect(res.statusCode).toBe(200)
    expect(res.headers["cache-control"]).toBe("private, no-store")
  })

  it("the in-memory cache the creator's read fills never answers anyone else", async () => {
    expect((await page(CREATOR)).statusCode).toBe(200)
    const res = await page(OTHER)
    expect(res.statusCode).toBe(404)
    expect(res.json()).toEqual(APP_NOT_FOUND)
    expect((await page(CREATOR)).statusCode).toBe(200)
  })
})

describe("GET /og/app/:slug and GET /v1/embed/:slug with outputs.allowPublic false", () => {
  it.each(SIGNED_OUT_AND_OTHER)("%s gets the card of an app that does not exist", async (_who, userId) => {
    const none = await missing(() => card(userId))
    const res = await card(userId)
    expect(res.statusCode).toBe(200)
    expect(res.body).toBe(none.body)
    expect(res.headers["cache-control"]).toBe(none.headers["cache-control"])
    expect(res.body).not.toContain("Zebrify")
  })

  it("the signed-in creator gets the real card, never stored by a shared cache", async () => {
    const res = await card(CREATOR)
    expect(res.body).toContain("Zebrify")
    expect(res.headers["cache-control"]).toBe("private, no-store")
  })

  it.each(SIGNED_OUT_AND_OTHER)("%s gets the embed answer of an app that does not exist", async (_who, userId) => {
    const none = await missing(() => embed(userId))
    const res = await embed(userId)
    expect(res.statusCode).toBe(404)
    expect(res.body).toBe(none.body)
    expect(res.headers["content-security-policy"]).toBeUndefined()
  })

  it("the signed-in creator gets the embed frame", async () => {
    const res = await embed(CREATOR)
    expect(res.statusCode).toBe(200)
    expect(res.headers["content-security-policy"]).toBe("frame-ancestors https://partner.example")
  })
})

const start = (userId?: string) => app.inject({ method: "POST", url: `/v1/app/${SLUG}/run`, headers: as(userId), payload: {} })
const draft = (userId?: string) => app.inject({ method: "POST", url: `/v1/app/${SLUG}/runs`, headers: as(userId), payload: {} })
const restore = (userId?: string) => app.inject({ method: "POST", url: `/v1/app/${SLUG}/runs/${RUN_ID}/restore`, headers: as(userId) })
const resume = (userId?: string) => app.inject({ method: "POST", url: `/v1/app/${SLUG}/runs/${RUN_ID}/resume`, headers: as(userId), payload: { dryRun: true } })
const rerender = (userId?: string) =>
  app.inject({ method: "POST", url: `/v1/app/${SLUG}/runs/${RUN_ID}/render-final`, headers: as(userId), payload: { renderNodeId: "n1" } })

const ROUTES = [
  ["POST /v1/app/:slug/run", start],
  ["POST /v1/app/:slug/runs", draft],
  ["POST …/runs/:runId/restore", restore],
  ["POST …/runs/:runId/resume", resume],
  ["POST …/runs/:runId/render-final", rerender],
] as const

describe("starting, restoring, continuing or re-rendering a run, with outputs.allowPublic false", () => {
  it.each(ROUTES)("%s: another signed-in user's run of the app is refused as for an app that does not exist", async (_label, call) => {
    h.rows.set("app_runs", [runRow(OTHER)])
    const res = await call(OTHER)
    expect(res.statusCode).toBe(404)
    expect(res.json()).toEqual(APP_NOT_FOUND)
  })

  it.each(ROUTES)("%s: a signed-out visitor is asked to sign in, as before", async (_label, call) => {
    expect((await call(undefined)).statusCode).toBe(401)
  })

  it.each(ROUTES)("%s: the creator goes past the check", async (_label, call) => {
    h.rows.set("app_runs", [runRow(CREATOR)])
    const res = await call(CREATOR)
    expect(res.json()).not.toEqual(APP_NOT_FOUND)
  })
})

describe("a runner's own past runs stay readable, with outputs.allowPublic false", () => {
  it("GET /v1/app/:slug/runs/:runId answers the runner's own run of someone else's app", async () => {
    h.rows.set("app_runs", [{
      ...runRow(OTHER),
      input_values: {},
      status: "completed",
      name: null,
      credits_used: 5,
      hidden_nodes: [],
      created_at: "2026-01-01T12:00:00Z",
      workflow_executions: { id: EXEC_ID, user_id: OTHER, workflow_id: WORKFLOW_ID, status: "completed", node_states: {}, total_nodes: 1, completed_nodes: 1, failed_nodes: 0, total_credits_used: 5, error_message: null, completed_at: "2026-01-01T12:05:00Z" },
    }])
    const res = await app.inject({ method: "GET", url: `/v1/app/${SLUG}/runs/${RUN_ID}`, headers: as(OTHER) })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({ id: RUN_ID, appId: APP_ID })
    expect(res.body).not.toContain("secret prompt")
  })
})

describe.each([
  ["no profile (the default)", null],
  ["a profile that allows public outputs", { outputs: { allowPublic: true } }],
])("with public outputs allowed: %s", (_label, profile) => {
  beforeEach(() => setProfile(profile))

  describe.each([
    ["a signed-out visitor", undefined],
    ["another signed-in user", OTHER],
    ["the creator", CREATOR],
  ] as const)("%s", (_who, userId) => {
    it("reads the page, with the same shared-cache headers as before", async () => {
      const res = await page(userId)
      expect(res.statusCode).toBe(200)
      expect(res.json()).toMatchObject({ id: APP_ID, creatorId: CREATOR })
      expect(res.headers["cache-control"]).toBe("public, max-age=10, s-maxage=10, stale-while-revalidate=86400")
      expect(res.headers["vary"]).toBeUndefined()
    })

    it("gets the real card, with the same shared-cache header as before", async () => {
      const res = await card(userId)
      expect(res.body).toContain("Zebrify")
      expect(res.headers["cache-control"]).toBe("public, max-age=3600, s-maxage=3600")
    })

    it("gets the embed frame", async () => {
      const res = await embed(userId)
      expect(res.statusCode).toBe(200)
      expect(res.headers["content-security-policy"]).toBe("frame-ancestors https://partner.example")
    })

    it.each(ROUTES)("%s: as before (past the check when signed in; asked to sign in otherwise)", async (_route, call) => {
      if (userId) h.rows.set("app_runs", [runRow(userId)])
      const res = await call(userId)
      if (!userId) expect(res.statusCode).toBe(401)
      else expect(res.json()).not.toEqual(APP_NOT_FOUND)
    })
  })
})
