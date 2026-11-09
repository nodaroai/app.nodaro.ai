import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"

/**
 * Community listings on a deployment that does not allow public outputs
 * (`outputs.allowPublic: false`): every route that serves a listing answers as
 * if none were listed — browse and favorites list nothing, a card, its full
 * detail and a clone are not found — and none of them reads a listing to say
 * so. An empty index beside a detail page that still answers by slug would be
 * a deny in name only. With the switch on (the default) nothing changes.
 */

const { cloneListing } = vi.hoisted(() => ({ cloneListing: vi.fn() }))
vi.mock("../../services/community/clone.js", () => ({ cloneListing }))
vi.mock("../../../lib/supabase.js", () => ({ supabase: { from: vi.fn() } }))
vi.mock("../../../lib/scope-prehandler.js", () => ({ requireAppScope: () => async () => {} }))

import { communityRoutes } from "../community.js"
import { supabase } from "../../../lib/supabase.js"
import { __resetSurfaceProfileCacheForTests } from "../../../lib/surface-profile.js"

const USER = { "x-user-id": "u1" }

function chain(result: unknown) {
  const proxy: Record<string, unknown> = new Proxy(
    {},
    {
      get(_target, prop) {
        if (prop === "then") return (resolve: (v: unknown) => void) => resolve(result)
        return () => proxy
      },
    },
  )
  return proxy
}

function setProfile(profile: Record<string, unknown> | null) {
  if (profile) process.env.NODARO_SURFACE_PROFILE = JSON.stringify(profile)
  else delete process.env.NODARO_SURFACE_PROFILE
  __resetSurfaceProfileCacheForTests()
}

let app: FastifyInstance
beforeEach(async () => {
  vi.clearAllMocks()
  vi.mocked(supabase.from).mockReturnValue(chain({ data: [], error: null }) as never)
  setProfile({ outputs: { allowPublic: false } })
  app = Fastify({ logger: false })
  app.addHook("preHandler", async (req) => {
    const u = req.headers["x-user-id"]
    if (typeof u === "string") req.userId = u
  })
  await app.register(async (i) => {
    await communityRoutes(i)
  })
  await app.ready()
})
afterEach(async () => {
  setProfile(null)
  await app.close()
})

describe("community listings — a deployment that does not allow public outputs", () => {
  it("browse lists nothing, and reads no listing", async () => {
    const r = await app.inject({ method: "GET", url: "/v1/community/browse?entityType=character&sort=popular", headers: USER })
    expect(r.statusCode).toBe(200)
    expect(r.json()).toEqual({ data: [], nextCursor: null })
    expect(supabase.from).not.toHaveBeenCalled()
  })

  it("a listing's card and its full detail are not found", async () => {
    for (const url of ["/v1/community/detail/hero", "/v1/community/detail/hero/full"]) {
      const r = await app.inject({ method: "GET", url, headers: USER })
      expect(r.statusCode).toBe(404)
      expect(r.json().error).toEqual({ code: "not_found", message: "Listing not found" })
    }
    expect(supabase.from).not.toHaveBeenCalled()
  })

  it("favorites list nothing", async () => {
    const r = await app.inject({ method: "GET", url: "/v1/community/favorites", headers: USER })
    expect(r.statusCode).toBe(200)
    expect(r.json()).toEqual({ data: [] })
    expect(supabase.from).not.toHaveBeenCalled()
  })

  it("a listing cannot be cloned", async () => {
    const r = await app.inject({ method: "POST", url: "/v1/community/listings/L1/clone", headers: USER, payload: { entityType: "character" } })
    expect(r.statusCode).toBe(404)
    expect(r.json().error).toEqual({ code: "not_found", message: "Listing not available" })
    expect(cloneListing).not.toHaveBeenCalled()
  })

  it("still answers 401 first without a session", async () => {
    for (const url of ["/v1/community/browse", "/v1/community/detail/hero", "/v1/community/favorites"]) {
      expect((await app.inject({ method: "GET", url })).statusCode).toBe(401)
    }
  })

  it("with the switch on (the default), browse reads the listings as before", async () => {
    setProfile(null)
    const r = await app.inject({ method: "GET", url: "/v1/community/browse", headers: USER })
    expect(r.statusCode).toBe(200)
    expect(supabase.from).toHaveBeenCalledWith("community_listings")
  })
})
