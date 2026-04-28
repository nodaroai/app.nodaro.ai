import { describe, it, expect, beforeAll } from "vitest"
import { buildApp } from "../../app.js"
import type { FastifyInstance } from "fastify"

let app: FastifyInstance

beforeAll(async () => {
  app = await buildApp()
})

describe("GET /v1/openapi.json", () => {
  it("returns 200 without auth", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/openapi.json" })
    expect(res.statusCode).toBe(200)
  })

  it("returns valid OpenAPI 3.1 document", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/openapi.json" })
    const spec = res.json()
    expect(spec.openapi).toMatch(/^3\.1/)
    expect(spec.info.title).toBeDefined()
    expect(spec.info.version).toBeDefined()
    expect(spec.paths).toBeDefined()
  })

  it("includes at least one documented path", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/openapi.json" })
    const spec = res.json()
    expect(Object.keys(spec.paths).length).toBeGreaterThan(0)
  })

  it("documents the bearerAuth security scheme", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/openapi.json" })
    const spec = res.json()
    expect(spec.components?.securitySchemes?.bearerAuth).toBeDefined()
    expect(spec.components.securitySchemes.bearerAuth.type).toBe("http")
  })
})
