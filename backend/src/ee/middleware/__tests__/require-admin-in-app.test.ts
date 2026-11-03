import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"

const { mockCheckIsAdmin } = vi.hoisted(() => ({
  mockCheckIsAdmin: vi.fn<(userId: string) => Promise<boolean>>(),
}))

vi.mock("@/lib/admin-check.js", () => ({ checkIsAdmin: mockCheckIsAdmin }))

import { requireAdminInApp } from "../require-admin-in-app.js"

let app: FastifyInstance
let handled = 0

beforeEach(async () => {
  vi.clearAllMocks()
  handled = 0
  app = Fastify({ logger: false })
  // Stands in for the auth hook: who is asking, and with which credential.
  app.addHook("preHandler", async (req) => {
    const userId = req.headers["x-user-id"]
    if (typeof userId === "string") req.userId = userId
    const kind = req.headers["x-auth-kind"]
    if (typeof kind === "string") req.authKind = kind as typeof req.authKind
  })
  app.get("/test", { preHandler: requireAdminInApp }, async () => {
    handled += 1
    return { ok: true }
  })
  await app.ready()
})

afterEach(async () => {
  await app.close()
})

const ask = (headers: Record<string, string>) => app.inject({ method: "GET", url: "/test", headers })

describe("requireAdminInApp", () => {
  it("lets an administrator signed in to the app through", async () => {
    mockCheckIsAdmin.mockResolvedValue(true)
    const res = await ask({ "x-user-id": "admin-1", "x-auth-kind": "jwt" })
    expect(res.statusCode).toBe(200)
    expect(handled).toBe(1)
  })

  it.each(["api_token", "app_token", "billing_key", "internal"])("refuses an administrator's %s, before the handler", async (kind) => {
    mockCheckIsAdmin.mockResolvedValue(true)
    const res = await ask({ "x-user-id": "admin-1", "x-auth-kind": kind })
    expect(res.statusCode).toBe(403)
    expect(res.json().error.code).toBe("in_app_only")
    expect(handled).toBe(0)
  })

  it("refuses a request whose credential is unknown", async () => {
    mockCheckIsAdmin.mockResolvedValue(true)
    const res = await ask({ "x-user-id": "admin-1" })
    expect(res.statusCode).toBe(403)
    expect(res.json().error.code).toBe("in_app_only")
    expect(handled).toBe(0)
  })

  it("answers a non-administrator as requireAdmin does, whatever the credential", async () => {
    mockCheckIsAdmin.mockResolvedValue(false)
    const res = await ask({ "x-user-id": "user-1", "x-auth-kind": "api_token" })
    expect(res.statusCode).toBe(403)
    expect(res.json().error.code).toBe("forbidden")
    expect(handled).toBe(0)
  })

  it("answers 401 with nobody signed in", async () => {
    const res = await ask({ "x-auth-kind": "jwt" })
    expect(res.statusCode).toBe(401)
    expect(mockCheckIsAdmin).not.toHaveBeenCalled()
    expect(handled).toBe(0)
  })
})
