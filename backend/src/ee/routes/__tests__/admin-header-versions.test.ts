import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"
import type { HeaderVersionsReport, HeaderVersionsService } from "../../lib/header-versions/header-versions.js"

const ADMIN = "00000000-0000-4000-8000-0000000000ad"
const USER = "00000000-0000-4000-8000-0000000000aa"

vi.mock("@/ee/middleware/require-admin.js", () => ({
  requireAdmin: async (req: { userId?: string }, reply: { status: (c: number) => { send: (b: unknown) => void } }) => {
    if (req.userId !== ADMIN) reply.status(403).send({ error: { code: "forbidden", message: "Admin access required" } })
  },
}))

import { adminHeaderVersionsRoutes } from "../admin-header-versions.js"

const REPORT: HeaderVersionsReport = {
  configured: false,
  invalidProducts: [],
  headerPackage: null,
  latest: { status: "not_configured" },
  releaseNotes: { status: "not_configured" },
  headerMap: { status: "not_configured" },
  products: [],
  checkedAt: "2026-11-01T12:00:00.000Z",
}

let app: FastifyInstance
let report: Mock<HeaderVersionsService["report"]>

beforeEach(async () => {
  report = vi.fn<HeaderVersionsService["report"]>(async () => REPORT)
  app = Fastify({ logger: false })
  app.addHook("preHandler", async (req) => {
    const h = req.headers["x-user-id"]
    if (typeof h === "string") (req as { userId?: string }).userId = h
  })
  await app.register(adminHeaderVersionsRoutes, { service: { report } })
  await app.ready()
})

afterEach(async () => {
  await app.close()
})

const get = (url: string, user = ADMIN) => app.inject({ method: "GET", url, headers: { "x-user-id": user } })

describe("GET /v1/admin/header-versions", () => {
  it("is for admins only", async () => {
    expect((await get("/v1/admin/header-versions", USER)).statusCode).toBe(403)
    expect(report).not.toHaveBeenCalled()
  })

  it("answers the shared report; fresh=1 asks past the kept one", async () => {
    const res = await get("/v1/admin/header-versions")
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual(REPORT)
    expect(report).toHaveBeenLastCalledWith({ fresh: false })
    await get("/v1/admin/header-versions?fresh=1")
    expect(report).toHaveBeenLastCalledWith({ fresh: true })
  })

  it("any other fresh value is refused", async () => {
    const res = await get("/v1/admin/header-versions?fresh=yes")
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("validation_error")
    expect(report).not.toHaveBeenCalled()
  })
})
