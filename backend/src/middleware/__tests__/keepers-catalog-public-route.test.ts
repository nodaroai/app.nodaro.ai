/**
 * The Nodaro Keepers shelf is public: a client app shows it to visitors who
 * are not signed in and asks for a login only when they use one. It holds
 * no user data — the deployment's catalog, display fields only, the same
 * for every caller — so `GET /v1/keepers/catalog` takes no credential,
 * exactly like `GET /v1/node-presets/factory`. Copying one (`/copy`) and
 * curating it (`PUT /v1/<kind>/:id/catalog`) stay behind one. Pinned three
 * ways: the matcher, the OpenAPI lens (`isAnonymousRoute`), and the real
 * hook in front of the real routes.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"

vi.mock("@/lib/supabase.js", () => ({
  supabase: {
    from: vi.fn(),
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: null }, error: new Error("Invalid token") }) },
  },
}))
vi.mock("@/lib/admin-check.js", () => ({ warmAdminCache: vi.fn(), checkIsAdmin: vi.fn().mockResolvedValue(false) }))
vi.mock("@/ee/lib/keepers-store.js", async () => {
  const actual = await vi.importActual<typeof import("../../ee/lib/keepers-store.js")>("../../ee/lib/keepers-store.js")
  return {
    ...actual,
    listKeeperCatalog: vi.fn().mockResolvedValue({ data: [], next: null }),
    copyKeeper: vi.fn(),
    setKeeperCatalog: vi.fn(),
  }
})

import { __isPublicRouteForTest as isPublicRoute, isAnonymousRoute, registerAuthHook } from "../auth.js"
import { keeperRoutes } from "../../ee/routes/keepers.js"
import { copyKeeper, listKeeperCatalog } from "../../ee/lib/keepers-store.js"

describe("the public-route matcher", () => {
  it("GET /v1/keepers/catalog takes no credential, with or without its query", () => {
    expect(isPublicRoute("GET", "/v1/keepers/catalog")).toBe(true)
    expect(isPublicRoute("GET", "/v1/keepers/catalog?kind=character&limit=20")).toBe(true)
    expect(isAnonymousRoute("GET", "/v1/keepers/catalog")).toBe(true)
  })

  it("nothing else under /v1/keepers does, and no other method", () => {
    expect(isPublicRoute("POST", "/v1/keepers/catalog")).toBe(false)
    expect(isPublicRoute("GET", "/v1/keepers/catalogX")).toBe(false)
    expect(isPublicRoute("POST", "/v1/keepers/catalog/character/x/copy")).toBe(false)
    expect(isPublicRoute("GET", "/v1/keepers/catalog/character/x/copy")).toBe(false)
    expect(isPublicRoute("PUT", "/v1/characters/x/catalog")).toBe(false)
    expect(isAnonymousRoute("POST", "/v1/keepers/catalog/character/x/copy")).toBe(false)
  })
})

describe("the auth hook in front of the routes", () => {
  let app: FastifyInstance

  beforeAll(async () => {
    app = Fastify({ logger: false })
    registerAuthHook(app)
    await app.register(keeperRoutes)
    await app.ready()
  })

  afterAll(async () => {
    await app.close()
  })

  it("serves the shelf to a request with no credential at all", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/keepers/catalog?kind=object" })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ data: [], next: null })
    expect(listKeeperCatalog).toHaveBeenCalledWith({ kind: "object" })
  })

  it("refuses to copy without a credential, before the store is reached", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/keepers/catalog/object/00000000-0000-4000-8000-0000000000c1/copy" })
    expect(res.statusCode).toBe(401)
    expect(copyKeeper).not.toHaveBeenCalled()
  })

  it("refuses to curate without a credential", async () => {
    const res = await app.inject({ method: "PUT", url: "/v1/objects/00000000-0000-4000-8000-0000000000c1/catalog", payload: { catalog: true } })
    expect(res.statusCode).toBe(401)
  })
})
