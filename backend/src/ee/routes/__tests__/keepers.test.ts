import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"

// The store's real module (importActual below, for KEEPER_KINDS) loads the
// supabase client and the storage helpers; the route never touches them here.
vi.mock("@/lib/supabase.js", () => ({ supabase: { from: vi.fn() } }))
vi.mock("@/ee/lib/keepers-store.js", async () => {
  const actual = await vi.importActual<typeof import("../../lib/keepers-store.js")>("../../lib/keepers-store.js")
  return {
    ...actual,
    listKeeperCatalog: vi.fn(),
    copyKeeper: vi.fn(),
    setKeeperCatalog: vi.fn(),
  }
})
vi.mock("@/lib/admin-check.js", () => ({
  warmAdminCache: vi.fn(),
  checkIsAdmin: vi.fn().mockResolvedValue(false),
}))
vi.mock("@/lib/config.js", () => ({
  config: { EDITION: "cloud" },
  isCloud: () => true,
  hasCredits: () => true,
  isCommunity: () => false,
  isBusiness: () => false,
  hasAdmin: () => true,
  isMultiUser: () => true,
}))

import { keeperRoutes } from "../keepers.js"
import { copyKeeper, listKeeperCatalog, setKeeperCatalog } from "../../lib/keepers-store.js"
import { checkIsAdmin } from "../../../lib/admin-check.js"

const USER = "00000000-0000-4000-8000-000000000001"
const ADMIN = "00000000-0000-4000-8000-00000000000a"
const ITEM = "00000000-0000-4000-8000-0000000000c1"

let app: FastifyInstance

beforeEach(async () => {
  vi.mocked(listKeeperCatalog).mockReset()
  vi.mocked(copyKeeper).mockReset()
  vi.mocked(setKeeperCatalog).mockReset()
  vi.mocked(checkIsAdmin).mockReset()
  vi.mocked(checkIsAdmin).mockResolvedValue(false)
  app = Fastify({ logger: false })
  // Stand-in for the auth hook: the user id from a header, a programmatic
  // credential from another, so the admin gate's refusal of app tokens is
  // exercised without the real hook.
  app.addHook("preHandler", async (req) => {
    const user = req.headers["x-user-id"]
    if (typeof user === "string") req.userId = user
    if (req.headers["x-app-token"] === "1") {
      req.appAuthorization = { scopes: ["assets:write"] } as never
    }
  })
  await app.register(keeperRoutes)
  await app.ready()
})

afterEach(async () => {
  await app.close()
})

describe("GET /v1/keepers/catalog", () => {
  it("answers a guest (no user) with the page the store built, passing kind / cursor / limit through", async () => {
    vi.mocked(listKeeperCatalog).mockResolvedValue({ data: [], next: null })
    const res = await app.inject({ method: "GET", url: "/v1/keepers/catalog?kind=creature&limit=10&cursor=abc" })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ data: [], next: null })
    expect(listKeeperCatalog).toHaveBeenCalledWith({ kind: "creature", limit: 10, cursor: "abc" })
    // A public listing: cacheable for a minute, and rate-limited per address.
    expect(res.headers["cache-control"]).toBe("public, max-age=60")
  })

  it("declares a per-address rate limit on the public shelf", async () => {
    let seen: unknown
    const probe = Fastify({ logger: false })
    probe.addHook("onRoute", (opts) => {
      if (opts.method === "GET" && opts.url === "/v1/keepers/catalog") seen = opts.config
    })
    await probe.register(keeperRoutes)
    await probe.ready()
    await probe.close()
    expect(seen).toMatchObject({ rateLimit: { max: 60, timeWindow: "1 minute" } })
  })

  it("rejects an unknown kind and an out-of-range limit with validation_error, and never asks the store", async () => {
    for (const url of ["/v1/keepers/catalog?kind=person", "/v1/keepers/catalog?limit=0", "/v1/keepers/catalog?limit=201"]) {
      const res = await app.inject({ method: "GET", url })
      expect(res.statusCode, url).toBe(400)
      expect(res.json().error.code).toBe("validation_error")
    }
    expect(listKeeperCatalog).not.toHaveBeenCalled()
  })

  it("a cursor the store cannot read is a 400, not page 1", async () => {
    vi.mocked(listKeeperCatalog).mockResolvedValue({ error: "invalid_cursor" })
    const res = await app.inject({ method: "GET", url: "/v1/keepers/catalog?cursor=zzz" })
    expect(res.statusCode).toBe(400)
    expect(res.json().error).toEqual({ code: "validation_error", message: "Invalid cursor" })
  })
})

describe("POST /v1/keepers/catalog/:kind/:id/copy", () => {
  it("needs a signed-in caller", async () => {
    const res = await app.inject({ method: "POST", url: `/v1/keepers/catalog/character/${ITEM}/copy` })
    expect(res.statusCode).toBe(401)
    expect(copyKeeper).not.toHaveBeenCalled()
  })

  it("copies into the caller's account and answers the copy's id", async () => {
    vi.mocked(copyKeeper).mockResolvedValue({ ok: true, id: "copy-1", name: "Mira", created: true })
    const res = await app.inject({ method: "POST", url: `/v1/keepers/catalog/character/${ITEM}/copy`, headers: { "x-user-id": USER } })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ id: "copy-1", name: "Mira", kind: "character", created: true })
    expect(copyKeeper).toHaveBeenCalledWith("character", ITEM, USER)
  })

  it("an unknown kind or a non-uuid id is a 400; a row not on the shelf is a 404", async () => {
    const bad = await app.inject({ method: "POST", url: `/v1/keepers/catalog/person/${ITEM}/copy`, headers: { "x-user-id": USER } })
    expect(bad.statusCode).toBe(400)
    const badId = await app.inject({ method: "POST", url: "/v1/keepers/catalog/object/not-a-uuid/copy", headers: { "x-user-id": USER } })
    expect(badId.statusCode).toBe(400)
    vi.mocked(copyKeeper).mockResolvedValue({ error: "not_found" })
    const gone = await app.inject({ method: "POST", url: `/v1/keepers/catalog/object/${ITEM}/copy`, headers: { "x-user-id": USER } })
    expect(gone.statusCode).toBe(404)
    expect(gone.json().error.code).toBe("not_found")
  })

  it("files that do not fit the caller's storage are a 413, a closed personal space a 403 — the community clone's answers", async () => {
    vi.mocked(copyKeeper).mockResolvedValue({ error: "storage_limit_exceeded" })
    const full = await app.inject({ method: "POST", url: `/v1/keepers/catalog/object/${ITEM}/copy`, headers: { "x-user-id": USER } })
    expect(full.statusCode).toBe(413)
    expect(full.json().error.code).toBe("storage_limit_exceeded")
    vi.mocked(copyKeeper).mockResolvedValue({ error: "personal_space_disabled" })
    const closed = await app.inject({ method: "POST", url: `/v1/keepers/catalog/object/${ITEM}/copy`, headers: { "x-user-id": USER } })
    expect(closed.statusCode).toBe(403)
    expect(closed.json().error.code).toBe("personal_space_disabled")
  })
})

describe("PUT /v1/<kind>/:id/catalog (admin)", () => {
  it("a signed-in user who is not an admin gets forbidden, before the body is even read, and nothing is written", async () => {
    const res = await app.inject({
      method: "PUT",
      url: `/v1/characters/${ITEM}/catalog`,
      headers: { "x-user-id": USER },
      payload: { catalog: "not even valid" },
    })
    expect(res.statusCode).toBe(403)
    expect(res.json().error.code).toBe("forbidden")
    expect(setKeeperCatalog).not.toHaveBeenCalled()
  })

  it("an OAuth app token is refused even for an admin", async () => {
    vi.mocked(checkIsAdmin).mockResolvedValue(true)
    const res = await app.inject({
      method: "PUT",
      url: `/v1/locations/${ITEM}/catalog`,
      headers: { "x-user-id": ADMIN, "x-app-token": "1" },
      payload: { catalog: true },
    })
    expect(res.statusCode).toBe(403)
    expect(setKeeperCatalog).not.toHaveBeenCalled()
  })

  it("an admin marks their own row, on every kind's path, with the fields sent", async () => {
    vi.mocked(checkIsAdmin).mockResolvedValue(true)
    vi.mocked(setKeeperCatalog).mockResolvedValue({ ok: true, id: ITEM, catalog: true, sort: 2, category: "Pets" })
    for (const [path, kind] of [["characters", "character"], ["creatures", "creature"], ["locations", "location"], ["objects", "object"]] as const) {
      const res = await app.inject({
        method: "PUT",
        url: `/v1/${path}/${ITEM}/catalog`,
        headers: { "x-user-id": ADMIN },
        payload: { catalog: true, sort: 2, category: "Pets" },
      })
      expect(res.statusCode, path).toBe(200)
      expect(res.json()).toEqual({ id: ITEM, kind, catalog: true, sort: 2, category: "Pets" })
      expect(setKeeperCatalog).toHaveBeenLastCalledWith(kind, ITEM, ADMIN, { catalog: true, sort: 2, category: "Pets" })
    }
  })

  it("validates the body, and a row that is not the admin's is not_found", async () => {
    vi.mocked(checkIsAdmin).mockResolvedValue(true)
    const bad = await app.inject({ method: "PUT", url: `/v1/objects/${ITEM}/catalog`, headers: { "x-user-id": ADMIN }, payload: { catalog: "yes" } })
    expect(bad.statusCode).toBe(400)
    expect(bad.json().error.code).toBe("validation_error")
    vi.mocked(setKeeperCatalog).mockResolvedValue({ error: "not_found" })
    const notMine = await app.inject({ method: "PUT", url: `/v1/objects/${ITEM}/catalog`, headers: { "x-user-id": ADMIN }, payload: { catalog: true } })
    expect(notMine.statusCode).toBe(404)
  })
})
