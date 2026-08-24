import { describe, it, expect, beforeAll, afterEach } from "vitest"
import { buildApp } from "../../app.js"
import { __resetSurfaceProfileCacheForTests } from "../../lib/surface-profile.js"
import type { FastifyInstance } from "fastify"

let app: FastifyInstance

beforeAll(async () => {
  app = await buildApp()
})

describe("GET /v1/nodes", () => {
  it("returns 200 without auth (public endpoint)", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/nodes" })
    expect(res.statusCode).toBe(200)
  })

  it("returns an array of node descriptors", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/nodes" })
    const body = res.json()
    expect(Array.isArray(body.data)).toBe(true)
    expect(body.data.length).toBeGreaterThan(20)
  })

  it("each descriptor has required fields", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/nodes" })
    const body = res.json()
    for (const node of body.data) {
      expect(node).toHaveProperty("type")
      expect(node).toHaveProperty("label")
      expect(node).toHaveProperty("category")
      expect(node).toHaveProperty("outputType")
      expect(["image", "video", "audio", "text", "data", "none"]).toContain(node.outputType)
    }
  })

  it("text-prompt has expected input schema", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/nodes" })
    const body = res.json()
    const textPrompt = body.data.find((n: { type: string }) => n.type === "text-prompt")
    expect(textPrompt).toBeDefined()
    expect(textPrompt.inputSchema?.fields).toContainEqual(
      expect.objectContaining({ key: "text", type: "text" }),
    )
  })

  it("generate-image lists at least one provider", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/nodes" })
    const body = res.json()
    const genImage = body.data.find((n: { type: string }) => n.type === "generate-image")
    expect(genImage).toBeDefined()
    expect(genImage.providers).toBeDefined()
    expect(Array.isArray(genImage.providers)).toBe(true)
    expect(genImage.providers.length).toBeGreaterThan(0)
  })
})

describe("GET /v1/nodes/:type", () => {
  it("returns single node descriptor", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/nodes/generate-image" })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.data.type).toBe("generate-image")
  })

  it("returns 404 for unknown type", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/nodes/foo-bar-nonexistent" })
    expect(res.statusCode).toBe(404)
  })
})

describe("GET /v1/nodes honours surface nodes.deny (B1)", () => {
  afterEach(() => {
    delete process.env.NODARO_SURFACE_PROFILE
    __resetSurfaceProfileCacheForTests()
  })

  it("omits a denied node from the list and 404s on its detail", async () => {
    // generate-image lists + 200s by default (asserted above); denying it must
    // remove it from discovery and 404 its detail — the filter reads per request.
    process.env.NODARO_SURFACE_PROFILE = JSON.stringify({ nodes: { deny: ["generate-image"] } })
    __resetSurfaceProfileCacheForTests()
    const list = (await app.inject({ method: "GET", url: "/v1/nodes" })).json()
    expect(list.data.some((n: { type: string }) => n.type === "generate-image")).toBe(false)
    const detail = await app.inject({ method: "GET", url: "/v1/nodes/generate-image" })
    expect(detail.statusCode).toBe(404)
  })
})
