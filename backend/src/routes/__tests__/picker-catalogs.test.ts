import { describe, it, expect, beforeAll, afterAll } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"
import { pickerCatalogsRoutes } from "../picker-catalogs.js"

let app: FastifyInstance
beforeAll(async () => {
  app = Fastify()
  await app.register(pickerCatalogsRoutes)
  await app.ready()
})
afterAll(async () => {
  await app.close()
})

describe("GET /v1/picker-catalogs", () => {
  it("lists picker summaries", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/picker-catalogs" })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(Array.isArray(body.data)).toBe(true)
    expect(body.data.find((p: { nodeType: string }) => p.nodeType === "setting")).toBeTruthy()
  })

  it("returns a compact catalog for a known type", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/picker-catalogs/setting" })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.data.nodeType).toBe("setting")
    expect(body.data.detail).toBe("compact")
    expect(body.data.options[0].promptHint).toBeUndefined()
  })

  it("detail=full includes prompt fragments", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/picker-catalogs/setting?detail=full" })
    expect(res.json().data.options[0].promptHint).toBeTruthy()
  })

  it("404s an unknown type", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/picker-catalogs/not-a-picker" })
    expect(res.statusCode).toBe(404)
    expect(res.json().error.code).toBe("not_found")
  })

  it("400s an invalid detail query param", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/picker-catalogs/setting?detail=bogus" })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("validation_error")
  })
})
