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
const { bySourceRow } = vi.hoisted(() => ({ bySourceRow: { current: null as unknown } }))
vi.mock("../../../lib/supabase.js", () => ({
  supabase: {
    from: vi.fn(() => ({
      select: () => ({
        eq: () => ({
          eq: () => ({
            single: () => ({ data: { id: "src1", name: "Hero" } }),
            maybeSingle: () => ({ data: bySourceRow.current }),
          }),
        }),
      }),
    })),
  },
}))

import { adminCommunityRoutes } from "../admin-community.js"

let app: FastifyInstance
beforeEach(async () => {
  vi.clearAllMocks()
  bySourceRow.current = null
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

describe("GET /v1/admin/community/by-source/:entityType/:id", () => {
  it("401 without admin", async () => {
    const r = await app.inject({ method: "GET", url: "/v1/admin/community/by-source/character/src1" })
    expect(r.statusCode).toBe(401)
  })
  it("returns { data: null } when no listing exists for the source", async () => {
    bySourceRow.current = null
    const r = await app.inject({ method: "GET", url: "/v1/admin/community/by-source/character/src1", headers: { "x-user-id": "admin1" } })
    expect(r.statusCode).toBe(200)
    expect(r.json()).toEqual({ data: null })
  })
  it("returns { data: <row> } for an admin who owns the listing", async () => {
    const row = { id: "L1", slug: "hero-abc", entity_type: "character", title: "Hero", is_active: true, is_listed: true, clone_count: 2, favorite_count: 5, created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-02T00:00:00Z" }
    bySourceRow.current = row
    const r = await app.inject({ method: "GET", url: "/v1/admin/community/by-source/character/src1", headers: { "x-user-id": "admin1" } })
    expect(r.statusCode).toBe(200)
    expect(r.json()).toEqual({ data: row })
  })
})
