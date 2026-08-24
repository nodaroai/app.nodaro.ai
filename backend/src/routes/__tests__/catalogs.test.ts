import { describe, it, expect, beforeAll, afterAll } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"
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

describe("GET /v1/catalogs", () => {
  it("returns the projected registered catalogs (compact default), no promptHint", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/catalogs" })
    expect(res.statusCode).toBe(200)
    const body = res.json() as { data: Array<{ catalogId: string; options?: Array<Record<string, unknown>> }> }
    const setting = body.data.find((c) => c.catalogId === "setting")!
    expect(setting.options![0]).not.toHaveProperty("promptHint")
    expect(res.headers["cache-control"]).toContain("max-age")
  })

  it("detail=full includes promptHint; an invalid detail is 400", async () => {
    expect((await app.inject({ method: "GET", url: "/v1/catalogs?detail=full" })).statusCode).toBe(200)
    expect((await app.inject({ method: "GET", url: "/v1/catalogs?detail=bogus" })).statusCode).toBe(400)
  })
})
