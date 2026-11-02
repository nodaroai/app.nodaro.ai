/**
 * /v1/admin/import-sources (admin-import-sources.ts): an admin reads the list
 * with its version and replaces it; a save normalizes the domains, refuses a
 * bad one or a duplicate, sends the version it loaded, answers 409 when the
 * list moved since, and is audited.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"

const state = vi.hoisted(() => ({
  admin: true,
  policies: [] as Array<{ domain: string; status: string; note: string | null; updatedBy: string | null; updatedAt: string }>,
  audits: [] as unknown[],
  saves: [] as unknown[],
  reads: [] as boolean[],
  moved: false,
}))

vi.mock("../../../lib/admin-check.js", () => ({ checkIsAdmin: vi.fn(async () => state.admin), ADMIN_ROLES: ["admin", "super_admin"] }))
vi.mock("../admin-trends-lifecycle.js", () => ({
  audit: vi.fn(async (_req: unknown, ...rest: unknown[]) => {
    state.audits.push(rest)
  }),
}))
vi.mock("../../../lib/import-source-policy.js", async () => {
  const real = await vi.importActual<typeof import("../../../lib/import-source-policy.js")>("../../../lib/import-source-policy.js")
  return {
    ...real,
    listImportSourcePolicies: vi.fn(async (options?: { fresh?: boolean }) => {
      state.reads.push(options?.fresh === true)
      return state.policies
    }),
    replaceImportSourcePolicies: vi.fn(async (inputs: Array<{ domain: string; status: string; note?: string | null }>, adminId: string | null, version: string) => {
      if (state.moved) throw new real.ImportSourceVersionError()
      state.saves.push({ inputs, adminId, version })
      state.policies = inputs.map((p) => ({ domain: p.domain, status: p.status, note: p.note ?? null, updatedBy: adminId, updatedAt: "2026-11-02T00:00:00Z" }))
      return state.policies
    }),
  }
})

import { adminImportSourcesRoutes } from "../admin-import-sources.js"

const USER = "00000000-0000-4000-8000-000000000001"
let app: FastifyInstance

beforeEach(async () => {
  state.admin = true
  state.policies = [{ domain: "blocked.test", status: "disabled", note: null, updatedBy: null, updatedAt: "2026-11-01T00:00:00Z" }]
  state.audits = []
  state.saves = []
  state.reads = []
  state.moved = false
  app = Fastify({ logger: false })
  app.addHook("preHandler", async (req) => {
    const user = req.headers["x-user-id"]
    if (typeof user === "string") req.userId = user
  })
  await app.register(adminImportSourcesRoutes)
  await app.ready()
})
afterEach(async () => {
  await app.close()
})

const put = async (payload: unknown) => await app.inject({ method: "PUT", url: "/v1/admin/import-sources", headers: { "x-user-id": USER }, payload: payload as Record<string, unknown> })

describe("GET /v1/admin/import-sources", () => {
  it("answers the list and its version to an admin only", async () => {
    expect((await app.inject({ method: "GET", url: "/v1/admin/import-sources" })).statusCode).toBe(401)
    state.admin = false
    expect((await app.inject({ method: "GET", url: "/v1/admin/import-sources", headers: { "x-user-id": USER } })).statusCode).toBe(403)
    state.admin = true
    const res = await app.inject({ method: "GET", url: "/v1/admin/import-sources", headers: { "x-user-id": USER } })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ data: state.policies, version: "1:1793491200000" })
    // The admin screen reads the table itself, never the minute-old cache a download checks.
    expect(state.reads).toEqual([true])
  })
})

describe("PUT /v1/admin/import-sources", () => {
  it("normalizes the domains, refuses a bad one or a duplicate, saves whole with the version and audits", async () => {
    expect((await put({ policies: [{ domain: "not a domain", status: "disabled" }], version: "1:1" })).statusCode).toBe(400)
    expect((await put({ policies: [{ domain: ".example.com", status: "disabled" }], version: "1:1" })).statusCode).toBe(400)
    expect((await put({ policies: [{ domain: "a.test", status: "banned" }], version: "1:1" })).statusCode).toBe(400)
    expect((await put({ policies: [{ domain: "a.test", status: "disabled" }] })).statusCode).toBe(400)
    const dup = await put({ policies: [{ domain: "a.test", status: "disabled" }, { domain: "WWW.www.a.test", status: "approved" }], version: "1:1" })
    expect(dup.statusCode).toBe(400)
    expect(dup.json().error.message).toBe("A domain is listed twice")
    expect(state.saves).toEqual([])

    const ok = await put({ policies: [{ domain: "WWW.Blocked.test.", status: "disabled", note: "legal" }, { domain: "xn--80ak6aa92e.xn--p1ai", status: "approved" }], version: "1:1793491200000" })
    expect(ok.statusCode).toBe(200)
    expect(ok.json().data.map((p: { domain: string; status: string }) => `${p.domain}=${p.status}`)).toEqual(["blocked.test=disabled", "xn--80ak6aa92e.xn--p1ai=approved"])
    expect(ok.json().version).toBe("2:1793577600000")
    expect(state.saves).toEqual([{ inputs: [{ domain: "blocked.test", status: "disabled", note: "legal" }, { domain: "xn--80ak6aa92e.xn--p1ai", status: "approved" }], adminId: USER, version: "1:1793491200000" }])
    expect(state.audits).toEqual([["update_import_source_policies", "import_source_policies", "all", { domains: ["blocked.test=disabled", "xn--80ak6aa92e.xn--p1ai=approved"] }]])
  })

  it("a list that moved since it was loaded answers 409", async () => {
    state.moved = true
    const res = await put({ policies: [{ domain: "a.test", status: "disabled" }], version: "1:1" })
    expect(res.statusCode).toBe(409)
    expect(res.json().error.code).toBe("import_sources_changed")
    expect(state.audits).toEqual([])
  })
})
