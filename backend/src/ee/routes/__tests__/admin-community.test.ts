import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"

vi.mock("../../middleware/require-admin.js", () => ({
  requireAdmin: async (req: { userId?: string }, reply: { status: (n: number) => { send: (b: unknown) => void } }) => {
    if (!req.userId) { reply.status(401).send({ error: "no" }); return }
  },
}))
const { publishListing } = vi.hoisted(() => ({ publishListing: vi.fn() }))
vi.mock("../../services/community/publish.js", () => ({ publishListing }))
vi.mock("../../services/community/asset-lifecycle.js", () => ({ purgeCommunityListingBlobs: vi.fn() }))
vi.mock("../../../lib/supabase.js", () => ({
  supabase: { from: vi.fn(() => ({ select: () => ({ eq: () => ({ eq: () => ({ single: () => ({ data: { id: "src1", name: "Hero" } }) }) }) }) })) },
}))

import { adminCommunityRoutes } from "../admin-community.js"

let app: FastifyInstance
beforeEach(async () => {
  vi.clearAllMocks()
  app = Fastify({ logger: false })
  app.addHook("preHandler", async (req) => {
    const u = req.headers["x-user-id"]; if (typeof u === "string") req.userId = u
  })
  await app.register(async (i) => { await adminCommunityRoutes(i) })
  await app.ready()
})
afterEach(async () => app.close())

describe("POST /v1/admin/community/:entityType/:id/publish", () => {
  it("401 without admin", async () => {
    const r = await app.inject({ method: "POST", url: "/v1/admin/community/character/src1/publish", payload: { title: "t", attestation: true, likenessAttestation: true } })
    expect(r.statusCode).toBe(401)
  })
  it("400 when character lacks likenessAttestation", async () => {
    const r = await app.inject({ method: "POST", url: "/v1/admin/community/character/src1/publish", headers: { "x-user-id": "admin1" }, payload: { title: "t", attestation: true } })
    expect(r.statusCode).toBe(400)
  })
  it("publishes with attestations", async () => {
    publishListing.mockResolvedValue({ slug: "hero-abc", id: "L1" })
    const r = await app.inject({ method: "POST", url: "/v1/admin/community/character/src1/publish", headers: { "x-user-id": "admin1" }, payload: { title: "Hero", attestation: true, likenessAttestation: true } })
    expect(r.statusCode).toBe(200)
    expect(r.json().slug).toBe("hero-abc")
  })
})
