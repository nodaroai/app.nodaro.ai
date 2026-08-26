import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"

const ADMIN = "00000000-0000-4000-8000-000000000002"
const NON_ADMIN = "00000000-0000-4000-8000-000000000001"

const listUsers = vi.fn()
const updateUserById = vi.fn().mockResolvedValue({ error: null })
const deleteUser = vi.fn().mockResolvedValue({ error: null })
const invalidateAuthCache = vi.fn()

vi.mock("@/lib/supabase.js", () => ({
  supabase: {
    auth: {
      admin: {
        listUsers: (...a: unknown[]) => listUsers(...a),
        updateUserById: (...a: unknown[]) => updateUserById(...a),
        deleteUser: (...a: unknown[]) => deleteUser(...a),
      },
    },
  },
}))

vi.mock("@/middleware/auth.js", () => ({
  invalidateAuthCache: (...a: unknown[]) => invalidateAuthCache(...a),
}))

vi.mock("@/ee/middleware/require-admin.js", () => ({
  requireAdmin: async (
    req: { userId?: string },
    reply: { status: (c: number) => { send: (b: unknown) => void } },
  ) => {
    if (req.userId !== ADMIN) reply.status(403).send({ error: { code: "forbidden", message: "Admin access required" } })
  },
}))

import { adminSsoRoutes } from "../admin-sso.js"

/** One listUsers page; length < perPage(200) marks it the last page. */
function page(users: Array<{ id: string; app_metadata: Record<string, unknown> }>) {
  return { data: { users }, error: null }
}

let app: FastifyInstance
beforeEach(async () => {
  vi.clearAllMocks()
  app = Fastify({ logger: false })
  app.addHook("preHandler", async (req) => {
    const h = req.headers["x-user-id"]
    if (typeof h === "string") (req as { userId?: string }).userId = h
  })
  await app.register(async (i) => {
    await adminSsoRoutes(i)
  })
  await app.ready()
})
afterEach(async () => {
  await app.close()
})

function del(url: string, userId = ADMIN) {
  return app.inject({ method: "DELETE", url, headers: { "x-user-id": userId } })
}

describe("DELETE /v1/admin/sso/:provider/users/:subject", () => {
  it("403 for a non-admin", async () => {
    const res = await del("/v1/admin/sso/librechat/users/idp-7", NON_ADMIN)
    expect(res.statusCode).toBe(403)
  })

  it("400 on an invalid mode", async () => {
    listUsers.mockResolvedValue(page([]))
    const res = await del("/v1/admin/sso/librechat/users/idp-7?mode=nope")
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("validation_error")
  })

  it("404 when no account matches the (provider, subject)", async () => {
    listUsers.mockResolvedValue(page([{ id: "u-x", app_metadata: { sso: "librechat", sso_subject: "someone-else" } }]))
    const res = await del("/v1/admin/sso/librechat/users/idp-7")
    expect(res.statusCode).toBe(404)
  })

  it("matches on BOTH provider AND subject (subject alone under another provider is not a match)", async () => {
    listUsers.mockResolvedValue(page([{ id: "u-other", app_metadata: { sso: "other-idp", sso_subject: "idp-7" } }]))
    const res = await del("/v1/admin/sso/librechat/users/idp-7")
    expect(res.statusCode).toBe(404)
    expect(updateUserById).not.toHaveBeenCalled()
  })

  it("ban (default): bans re-login, clears the SSO marker, and invalidates the cache", async () => {
    listUsers.mockResolvedValue(page([{ id: "u-1", app_metadata: { sso: "librechat", sso_subject: "idp-7" } }]))
    const res = await del("/v1/admin/sso/librechat/users/idp-7")
    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({ ok: true, userId: "u-1", mode: "ban" })
    expect(updateUserById).toHaveBeenCalledWith("u-1", {
      ban_duration: "876000h",
      app_metadata: { sso: null, sso_subject: null },
    })
    expect(deleteUser).not.toHaveBeenCalled()
    expect(invalidateAuthCache).toHaveBeenCalledWith("u-1")
  })

  it("mode=delete: hard-removes the account and invalidates the cache", async () => {
    listUsers.mockResolvedValue(page([{ id: "u-1", app_metadata: { sso: "librechat", sso_subject: "idp-7" } }]))
    const res = await del("/v1/admin/sso/librechat/users/idp-7?mode=delete")
    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({ ok: true, userId: "u-1", mode: "delete" })
    expect(deleteUser).toHaveBeenCalledWith("u-1")
    expect(updateUserById).not.toHaveBeenCalled()
    expect(invalidateAuthCache).toHaveBeenCalledWith("u-1")
  })

  it("500 when the GoTrue call fails", async () => {
    listUsers.mockResolvedValue(page([{ id: "u-1", app_metadata: { sso: "librechat", sso_subject: "idp-7" } }]))
    updateUserById.mockResolvedValueOnce({ error: { message: "boom" } })
    const res = await del("/v1/admin/sso/librechat/users/idp-7")
    expect(res.statusCode).toBe(500)
    expect(invalidateAuthCache).not.toHaveBeenCalled()
  })
})
