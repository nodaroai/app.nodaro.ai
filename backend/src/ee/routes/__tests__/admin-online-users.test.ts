/**
 * GET /v1/admin/online-users carries client addresses: an admin signed in to
 * the app sees it; a non-admin, and an admin's API or app token, do not; the
 * deployment's payer is listed to itself only.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"
import type { PresenceEntry, PresenceStore } from "../../lib/presence.js"

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

import { adminOnlineUsersRoutes } from "../admin-online-users.js"

const seen = (userId: string): PresenceEntry => ({
  userId,
  source: "web",
  detail: "app.nodaro.ai",
  address: "203.0.113.7",
  country: "IL",
  userAgent: "Chrome",
  lastSeenAt: Date.now(),
})
const store: PresenceStore = { put: async () => undefined, since: async () => [seen("dana"), seen(PAYER)] }
const lookup = { profiles: async () => new Map(), apps: async () => new Map() }

let app: FastifyInstance

beforeEach(async () => {
  state.payer = null
  app = Fastify({ logger: false })
  app.addHook("preHandler", async (req) => {
    const user = req.headers["x-user-id"]
    if (typeof user === "string") req.userId = user
    req.authKind = (req.headers["x-auth-kind"] as typeof req.authKind) ?? "jwt"
  })
  await app.register(adminOnlineUsersRoutes, { store: async () => store, lookup })
  await app.ready()
})
afterEach(() => app.close())

const list = (userId: string, authKind = "jwt") =>
  app.inject({ method: "GET", url: "/v1/admin/online-users", headers: { "x-user-id": userId, "x-auth-kind": authKind } })

describe("GET /v1/admin/online-users", () => {
  it("an admin signed in to the app gets the list, with addresses", async () => {
    const res = await list(ADMIN)
    expect(res.statusCode).toBe(200)
    expect(res.json().users.map((u: { userId: string }) => u.userId).sort()).toEqual(["dana", PAYER].sort())
    expect(res.json().users[0].surfaces[0].address).toBe("203.0.113.7")
  })

  it("not to a non-admin", async () => {
    expect((await list("00000000-0000-4000-8000-0000000000aa")).statusCode).toBe(403)
  })

  it.each(["api_token", "app_token"])("not to an admin's %s — only to the admin in the app", async (kind) => {
    const res = await list(ADMIN, kind)
    expect(res.statusCode).toBe(403)
    expect(res.json().error.code).toBe("in_app_only")
  })

  it("the deployment's payer is listed to itself, never to another admin", async () => {
    state.payer = PAYER
    expect((await list(ADMIN)).json().users.map((u: { userId: string }) => u.userId)).toEqual(["dana"])
    expect((await list(PAYER)).json().users.map((u: { userId: string }) => u.userId).sort()).toEqual(["dana", PAYER].sort())
  })
})
