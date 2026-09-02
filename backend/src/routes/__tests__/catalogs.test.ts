import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"
import { registerCatalogPack, resetCatalogPacks, getPickerCatalog } from "@nodaro/prompts"
import { catalogsRoutes } from "../catalogs.js"

let app: FastifyInstance
beforeAll(async () => {
  app = Fastify()
  await app.register(catalogsRoutes)
  await app.ready()
})
afterAll(async () => {
  await app.close()
})
afterEach(() => resetCatalogPacks())

describe("GET /v1/catalogs", () => {
  it("with NO packs: says so and sends no body — the browser's bundle IS the catalog", async () => {
    // Every mainline page load hits this route. Serializing the whole
    // catalog set to report "nothing curated" would be the one measurable
    // cost of the feature on deployments that never use it.
    const res = await app.inject({ method: "GET", url: "/v1/catalogs" })
    expect(res.statusCode).toBe(200)
    const body = res.json() as { data?: unknown; curated: boolean; packs: number; version: number }
    expect(body.curated).toBe(false)
    expect(body.packs).toBe(0)
    expect(body).not.toHaveProperty("data")
    expect(typeof body.version).toBe("number")
    expect(res.headers["cache-control"]).toContain("max-age")
    expect(res.body.length).toBeLessThan(200)
  })

  it("with a pack: returns the projected COMPOSED catalogs (compact default, no promptHint)", async () => {
    const base = getPickerCatalog("setting")!
    registerCatalogPack({ id: "t", catalogId: "setting", mode: "deny", denyIds: [base.options![0].id] })
    const res = await app.inject({ method: "GET", url: "/v1/catalogs" })
    expect(res.statusCode).toBe(200)
    const body = res.json() as { data: Array<{ catalogId: string; options?: Array<Record<string, unknown>> }>; curated: boolean; packs: number }
    expect(body.curated).toBe(true)
    expect(body.packs).toBe(1)
    const setting = body.data.find((c) => c.catalogId === "setting")!
    expect(setting.options!.map((o) => o.id)).not.toContain(base.options![0].id)
    expect(setting.options![0]).not.toHaveProperty("promptHint")
  })

  it("detail=full includes promptHint; an invalid detail is 400", async () => {
    registerCatalogPack({ id: "t", catalogId: "setting", mode: "deny", denyIds: [] })
    const full = await app.inject({ method: "GET", url: "/v1/catalogs?detail=full" })
    expect(full.statusCode).toBe(200)
    const setting = (full.json() as { data: Array<{ catalogId: string; options?: Array<Record<string, unknown>> }> }).data.find((c) => c.catalogId === "setting")!
    expect(setting.options![0]).toHaveProperty("promptHint")
    expect((await app.inject({ method: "GET", url: "/v1/catalogs?detail=bogus" })).statusCode).toBe(400)
  })
})
