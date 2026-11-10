/**
 * GET /v1/admin/user-surfaces: an admin signed in to the app gets the rows,
 * of one kind or every kind; a non-admin, and an admin's API or app token,
 * do not; a kind the code cannot name is refused before the table is read;
 * the deployment's payer is listed to itself only; a table that cannot be
 * read says so, with the reason.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"
import type { UserSurfaceRecord, UserSurfacesRead } from "../../lib/user-surfaces-list.js"

const ADMIN = "00000000-0000-4000-8000-0000000000ad"
const PAYER = "00000000-0000-4000-8000-0000000000bb"
const state = vi.hoisted(() => ({ payer: null as string | null }))

vi.mock("@/ee/middleware/require-admin.js", () => ({
  requireAdmin: async (req: { userId?: string }, reply: { status: (c: number) => { send: (b: unknown) => unknown } }) => {
    if (req.userId !== "00000000-0000-4000-8000-0000000000ad" && req.userId !== "00000000-0000-4000-8000-0000000000bb") {
      return reply.status(403).send({ error: { code: "forbidden", message: "Admin access required" } })
    }
  },
}))
vi.mock("@/lib/deployment-payer.js", () => ({ deploymentPayerId: () => state.payer }))

import { adminUserSurfacesRoutes } from "../admin-user-surfaces.js"

const record = (user_id: string, over: Partial<UserSurfaceRecord> = {}): UserSurfaceRecord => ({
  user_id,
  source: "web",
  detail: "app.nodaro.ai",
  first_seen_at: "2026-11-08T18:00:00.000Z",
  last_seen_at: "2026-11-10T08:00:00.000Z",
  touches: 2,
  ...over,
})
const lookup = { profiles: async () => new Map(), apps: async () => new Map() }

let read: ReturnType<typeof vi.fn<UserSurfacesRead>>
let app: FastifyInstance

beforeEach(async () => {
  state.payer = null
  // As the database would: the kind asked for, less the hidden account, counted the same way.
  read = vi.fn<UserSurfacesRead>(async ({ source, hiddenUserId }) => {
    const rows = [record("dana", source ? { source, detail: "" } : {}), record(PAYER)].filter((row) => row.user_id !== hiddenUserId)
    return { rows, total: rows.length, recordedSince: "2026-11-08T18:00:00.000Z" }
  })
  app = Fastify({ logger: false })
  app.addHook("preHandler", async (req) => {
    const user = req.headers["x-user-id"]
    if (typeof user === "string") req.userId = user
    req.authKind = (req.headers["x-auth-kind"] as typeof req.authKind) ?? "jwt"
  })
  await app.register(adminUserSurfacesRoutes, { read, lookup })
  await app.ready()
})
afterEach(() => app.close())

const list = (userId: string, query = "", authKind = "jwt") =>
  app.inject({ method: "GET", url: `/v1/admin/user-surfaces${query}`, headers: { "x-user-id": userId, "x-auth-kind": authKind } })
const userIds = (res: { json: () => { rows: Array<{ userId: string }> } }) => res.json().rows.map((row) => row.userId).sort()

describe("GET /v1/admin/user-surfaces", () => {
  it("an admin signed in to the app gets every kind, and may ask for one", async () => {
    const res = await list(ADMIN)
    expect(res.statusCode).toBe(200)
    expect(read).toHaveBeenLastCalledWith({ source: null, hiddenUserId: null, limit: 500 })
    expect(userIds(res)).toEqual(["dana", PAYER].sort())
    expect(res.json()).toMatchObject({ source: null, recordedSince: "2026-11-08T18:00:00.000Z", people: 2, total: 2, truncated: false })

    const ext = await list(ADMIN, "?source=extension")
    expect(ext.statusCode).toBe(200)
    expect(read).toHaveBeenLastCalledWith({ source: "extension", hiddenUserId: null, limit: 500 })
    expect(ext.json().source).toBe("extension")
    expect(ext.json().rows[0]).toMatchObject({ userId: "dana", label: "EXT", detail: null })
  })

  it("not to a non-admin", async () => {
    expect((await list("00000000-0000-4000-8000-0000000000aa")).statusCode).toBe(403)
    expect(read).not.toHaveBeenCalled()
  })

  it.each(["api_token", "app_token"])("not to an admin's %s — only to the admin in the app", async (kind) => {
    const res = await list(ADMIN, "", kind)
    expect(res.statusCode).toBe(403)
    expect(res.json().error.code).toBe("in_app_only")
    expect(read).not.toHaveBeenCalled()
  })

  it.each(["internal", "bogus"])("a kind the code cannot name (%s) is refused before the table is read", async (source) => {
    const res = await list(ADMIN, `?source=${source}`)
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("validation_error")
    expect(read).not.toHaveBeenCalled()
  })

  it("the deployment's payer is listed to itself, never to another admin — left out by the read itself", async () => {
    state.payer = PAYER
    expect(userIds(await list(ADMIN))).toEqual(["dana"])
    expect(read).toHaveBeenLastCalledWith({ source: null, hiddenUserId: PAYER, limit: 500 })
    expect(userIds(await list(PAYER))).toEqual(["dana", PAYER].sort())
    expect(read).toHaveBeenLastCalledWith({ source: null, hiddenUserId: null, limit: 500 })
  })

  it("a table that cannot be read says so, with the reason", async () => {
    read.mockRejectedValueOnce(new Error('relation "user_surfaces" does not exist'))
    const res = await list(ADMIN)
    expect(res.statusCode).toBe(503)
    expect(res.json().error.code).toBe("user_surfaces_unavailable")
    expect(res.json().error.message).toMatch(/does not exist/)
  })
})
