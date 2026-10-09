import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"

/**
 * The workflow lists a personal API key limited to some workflows can call
 * (declared `workflowScope: "handler"`: the handler applies the list itself).
 * Each one narrows to the key's workflows, and the admin "all users" view is
 * refused to such a key, an admin's included.
 */

const h = vi.hoisted(() => {
  const calls: Array<{ table: string; method: string; args: unknown[] }> = []
  function chain(table: string, answer: () => unknown): unknown {
    const proxy: unknown = new Proxy(() => {}, {
      get(_t, prop) {
        if (prop === "then") return (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) => Promise.resolve(answer()).then(ok, ko)
        if (prop === "single" || prop === "maybeSingle") return async () => answer()
        return (...args: unknown[]) => {
          calls.push({ table, method: String(prop), args })
          return proxy
        }
      },
    })
    return proxy
  }
  return { calls, chain, checkIsAdmin: vi.fn(async () => true) }
})

vi.mock("@/lib/supabase.js", () => ({
  supabase: {
    from: (table: string) =>
      h.chain(table, () =>
        table === "projects"
          ? { data: { id: "00000000-0000-4000-8000-000000000010", app_slug: null, user_id: "00000000-0000-4000-8000-000000000001", workspace_id: null }, error: null }
          : { data: [], error: null },
      ),
    auth: { getUser: vi.fn() },
  },
}))

vi.mock("@/lib/config.js", () => ({
  config: { EDITION: "cloud", SUPABASE_URL: "https://test.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "test" },
  isCloud: () => true,
  hasCredits: () => true,
  isCommunity: () => false,
  isBusiness: () => false,
  hasAdmin: () => true,
}))

vi.mock("@/lib/admin-check.js", () => ({
  warmAdminCache: vi.fn(),
  checkIsAdmin: h.checkIsAdmin,
}))

import { workflowRoutes } from "../workflows.js"
import { LIMITED_KEY_MESSAGE } from "../../middleware/token-workflow-scope.js"

const USER = "00000000-0000-4000-8000-000000000001"
const PROJECT = "00000000-0000-4000-8000-000000000010"
const ALLOWED = "0b9a6f8e-1111-4222-8333-444455556666"

let app: FastifyInstance

beforeEach(async () => {
  h.calls.length = 0
  h.checkIsAdmin.mockClear()
  app = Fastify({ logger: false })
  // What the auth hook sets for a personal API key: `x-key-workflows` lists the
  // key's workflows (empty = the account's full-access key).
  app.addHook("preHandler", async (req) => {
    req.userId = USER
    const workspace = req.headers["x-workspace-id"]
    if (typeof workspace === "string") req.workspaceId = workspace
    const listed = req.headers["x-key-workflows"]
    if (typeof listed === "string") {
      req.authKind = "api_token"
      req.apiToken = { id: "t1", userId: USER, workflowIds: listed ? listed.split(",") : [], rateLimit: 30, tokenHash: "h", workspaceId: null }
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

function get(url: string, keyWorkflows: string) {
  return app.inject({ method: "GET", url, headers: { "x-key-workflows": keyWorkflows } })
}

function narrowedTo(table: string): unknown[][] {
  return h.calls.filter((c) => c.table === table && c.method === "in" && c.args[0] === "id").map((c) => c.args[1] as unknown[])
}

describe("GET /v1/workflows", () => {
  it("lists only the key's workflows", async () => {
    const res = await get("/v1/workflows", ALLOWED)
    expect(res.statusCode).toBe(200)
    expect(narrowedTo("workflows")).toEqual([[ALLOWED]])
  })

  it("lists only the key's workflows inside a workspace too", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/workflows",
      headers: { "x-key-workflows": ALLOWED, "x-workspace-id": "00000000-0000-4000-8000-0000000000f1" },
    })
    expect(res.statusCode).toBe(200)
    expect(h.calls).toContainEqual({ table: "workflows", method: "eq", args: ["workspace_id", "00000000-0000-4000-8000-0000000000f1"] })
    expect(narrowedTo("workflows")).toEqual([[ALLOWED]])
  })

  it("refuses the admin view to the key, an admin's included", async () => {
    const res = await get("/v1/workflows?viewAll=true", ALLOWED)
    expect(res.statusCode).toBe(403)
    expect(res.json()).toEqual({ error: { code: "forbidden", message: LIMITED_KEY_MESSAGE } })
    expect(h.checkIsAdmin).not.toHaveBeenCalled()
    expect(h.calls).toEqual([])
  })

  it("a full-access key lists everything, as before", async () => {
    expect((await get("/v1/workflows", "")).statusCode).toBe(200)
    expect(narrowedTo("workflows")).toEqual([])
  })
})

describe("GET /v1/projects/:projectId/workflows", () => {
  it("lists only the key's workflows", async () => {
    const res = await get(`/v1/projects/${PROJECT}/workflows`, ALLOWED)
    expect(res.statusCode).toBe(200)
    expect(narrowedTo("workflows")).toEqual([[ALLOWED]])
  })

  it("a full-access key lists everything, as before", async () => {
    expect((await get(`/v1/projects/${PROJECT}/workflows`, "")).statusCode).toBe(200)
    expect(narrowedTo("workflows")).toEqual([])
  })
})
