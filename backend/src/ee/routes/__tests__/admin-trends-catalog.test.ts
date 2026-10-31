/**
 * POST /v1/admin/trends/catalog/refresh (admin-trends-catalog.ts): an admin
 * drops every kept copy of the guest catalog by hand. It says "done" only when
 * the new stamp was written (then every process drops its copies), and writes
 * an admin_actions row; anyone else is refused before anything moves.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"

const state = vi.hoisted(() => ({ admin: true, stampWritten: true, changes: 0, audits: [] as unknown[] }))

vi.mock("../../../lib/admin-check.js", () => ({ checkIsAdmin: vi.fn(async () => state.admin) }))
vi.mock("../../lib/trends/catalog-stamp.js", () => ({
  trendCatalogChanged: vi.fn(async () => {
    state.changes += 1
    return state.stampWritten
  }),
}))
vi.mock("../admin-trends-lifecycle.js", () => ({
  audit: vi.fn(async (...args: unknown[]) => {
    state.audits.push(args.slice(1))
  }),
}))

import { registerTrendCatalogRoutes } from "../admin-trends-catalog.js"

const USER = "00000000-0000-4000-8000-000000000001"
let app: FastifyInstance

beforeEach(async () => {
  state.admin = true
  state.stampWritten = true
  state.changes = 0
  state.audits = []
  app = Fastify({ logger: false })
  app.addHook("preHandler", async (req) => {
    const user = req.headers["x-user-id"]
    if (typeof user === "string") req.userId = user
  })
  registerTrendCatalogRoutes(app)
  await app.ready()
})

afterEach(async () => {
  await app.close()
})

const refresh = (headers: Record<string, string> = { "x-user-id": USER }) =>
  app.inject({ method: "POST", url: "/v1/admin/trends/catalog/refresh", headers })

describe("POST /v1/admin/trends/catalog/refresh", () => {
  it("moves the catalog stamp, records who did it, and answers when", async () => {
    const res = await refresh()
    expect(res.statusCode).toBe(200)
    expect(Date.parse(res.json().data.refreshedAt)).not.toBeNaN()
    expect(state.changes).toBe(1)
    expect(state.audits).toEqual([["refresh_trend_catalog", "trend_catalog", "00000000-0000-0000-0000-000000000000", {}]])
  })

  it("a stamp that could not be written is a 503, never a success, and no audit row", async () => {
    state.stampWritten = false
    const res = await refresh()
    expect(res.statusCode).toBe(503)
    expect(res.json().error.code).toBe("refresh_failed")
    expect(state.audits).toEqual([])
  })

  it("is admin-only: a guest or a non-admin moves nothing", async () => {
    expect((await refresh({})).statusCode).toBe(401)
    state.admin = false
    expect((await refresh()).statusCode).toBe(403)
    expect(state.changes).toBe(0)
  })
})
