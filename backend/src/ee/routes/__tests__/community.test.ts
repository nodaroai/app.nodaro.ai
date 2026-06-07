import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"

const { cloneListing } = vi.hoisted(() => ({ cloneListing: vi.fn() }))
vi.mock("../../services/community/clone.js", () => ({ cloneListing }))
vi.mock("../../../lib/supabase.js", () => ({ supabase: { from: vi.fn() } }))
vi.mock("../../../lib/scope-prehandler.js", () => ({ requireAppScope: () => async () => {} }))
import { communityRoutes } from "../community.js"

let app: FastifyInstance
beforeEach(async () => {
  vi.clearAllMocks()
  app = Fastify({ logger: false })
  app.addHook("preHandler", async (req) => { const u = req.headers["x-user-id"]; if (typeof u === "string") req.userId = u })
  await app.register(async (i) => { await communityRoutes(i) })
  await app.ready()
})
afterEach(async () => app.close())

describe("POST /v1/community/listings/:id/clone", () => {
  it("401 without session", async () => {
    const r = await app.inject({ method: "POST", url: "/v1/community/listings/L1/clone", payload: { entityType: "character" } })
    expect(r.statusCode).toBe(401)
  })
  it("returns the clone id", async () => {
    cloneListing.mockResolvedValue({ entityType: "character", id: "new1" })
    const r = await app.inject({ method: "POST", url: "/v1/community/listings/L1/clone", headers: { "x-user-id": "u1" }, payload: { entityType: "character" } })
    expect(r.statusCode).toBe(200); expect(r.json().id).toBe("new1")
  })
  it("maps storage_limit_exceeded to 413", async () => {
    const e = new Error("over") as Error & { code?: string }; e.code = "storage_limit_exceeded"
    cloneListing.mockRejectedValue(e)
    const r = await app.inject({ method: "POST", url: "/v1/community/listings/L1/clone", headers: { "x-user-id": "u1" }, payload: { entityType: "character" } })
    expect(r.statusCode).toBe(413); expect(r.json().error.code).toBe("storage_limit_exceeded")
  })
})
