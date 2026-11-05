/**
 * /v1/admin/content-rights/import-share (admin-import-share.ts): an admin reads
 * the imports of the last days with and without a confirmation, and when
 * counting began when that is inside the window; the window is 1 to 90 days,
 * 7 when not given; a failed read is a 500 that does not pass the database's
 * message on; nobody else reads it.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"

const state = vi.hoisted(() => ({
  admin: true,
  reads: [] as number[],
  fail: false,
  countingSince: null as string | null,
  rows: [
    { declaration: "checkbox", lane: null, via: null, appId: null, imports: 4 },
    { declaration: "none", lane: "run", via: "api", appId: null, imports: 2 },
  ],
}))

vi.mock("../../../lib/admin-check.js", () => ({ checkIsAdmin: vi.fn(async () => state.admin), ADMIN_ROLES: ["admin", "super_admin"] }))
vi.mock("../../../lib/unconfirmed-imports.js", () => ({
  IMPORT_SHARE_MAX_DAYS: 90,
  importDeclarationShare: vi.fn(async (days: number) => {
    state.reads.push(days)
    if (state.fail) throw new Error("content_rights_import_share failed: relation does not exist")
    return { countingSince: state.countingSince, rows: state.rows }
  }),
}))

import { adminImportShareRoutes } from "../admin-import-share.js"

const USER = "00000000-0000-4000-8000-000000000001"
const ROUTE = "/v1/admin/content-rights/import-share"
let app: FastifyInstance

beforeEach(async () => {
  state.admin = true
  state.reads = []
  state.fail = false
  state.countingSince = null
  app = Fastify({ logger: false })
  app.addHook("preHandler", async (req) => {
    const user = req.headers["x-user-id"]
    if (typeof user === "string") req.userId = user
  })
  await app.register(adminImportShareRoutes)
  await app.ready()
})
afterEach(async () => {
  await app.close()
})

const get = async (query = "") => await app.inject({ method: "GET", url: `${ROUTE}${query}`, headers: { "x-user-id": USER } })

describe("GET /v1/admin/content-rights/import-share", () => {
  it("answers the counts of the last 7 days to an admin only", async () => {
    expect((await app.inject({ method: "GET", url: ROUTE })).statusCode).toBe(401)
    state.admin = false
    expect((await get()).statusCode).toBe(403)
    expect(state.reads).toEqual([])
    state.admin = true
    const res = await get()
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ data: state.rows, days: 7, countingSince: null })
    expect(state.reads).toEqual([7])
  })

  it("says when counting began, when that is inside the window", async () => {
    state.countingSince = "2026-11-02T10:00:00.000Z"
    expect((await get("?days=30")).json()).toMatchObject({ days: 30, countingSince: "2026-11-02T10:00:00.000Z" })
  })

  it("reads the window asked for, from 1 to 90 days", async () => {
    expect((await get("?days=1")).json()).toMatchObject({ days: 1 })
    expect((await get("?days=90")).json()).toMatchObject({ days: 90 })
    expect(state.reads).toEqual([1, 90])
  })

  it("refuses a window outside 1 to 90 days, or not a whole number, and reads nothing", async () => {
    for (const days of ["0", "91", "1.5", "week", "-3"]) {
      const res = await get(`?days=${days}`)
      expect(res.statusCode).toBe(400)
      expect(res.json().error.code).toBe("validation_error")
    }
    expect(state.reads).toEqual([])
  })

  it("a failed read is a 500 that does not pass the database's message on", async () => {
    state.fail = true
    const res = await get()
    expect(res.statusCode).toBe(500)
    expect(res.body).not.toContain("relation does not exist")
  })
})
