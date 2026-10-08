/**
 * GET /v1/site-assets/assets/:name — what the Caddyfile asks for a name the
 * running build does not have. An archived styling file comes back as itself,
 * typed by its name, cached for good and readable from any origin; anything
 * else is a 404 nobody caches, and storage is never asked about a name the
 * archive could not hold.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"
import { Readable } from "node:stream"
import Fastify from "fastify"

const state = vi.hoisted(() => ({ enabled: true, objects: new Map<string, { body: string; contentType: string | null }>(), streams: [] as Array<{ destroyed: boolean }> }))

vi.mock("../../lib/site-asset-archive.js", () => ({ siteAssetArchiveEnabled: () => state.enabled }))
vi.mock("../../lib/storage.js", () => ({
  streamR2Object: vi.fn(async (key: string) => {
    const object = state.objects.get(key)
    if (!object) return null
    const body = Readable.from([object.body])
    state.streams.push(body)
    return { body, contentType: object.contentType, contentLength: object.body.length, contentRange: null }
  }),
}))

import { streamR2Object } from "../../lib/storage.js"
import { siteAssetRoutes } from "../site-assets.js"

async function app() {
  const server = Fastify({ logger: false })
  await server.register(siteAssetRoutes)
  await server.ready()
  return server
}

beforeEach(() => {
  state.enabled = true
  state.objects.clear()
  state.streams.length = 0
  vi.mocked(streamR2Object).mockClear()
})

describe("GET /v1/site-assets/assets/:name", () => {
  it("an earlier build's stylesheet: itself, as CSS whatever storage says, cached for good, readable from any origin", async () => {
    state.objects.set("site-assets/assets/index-Dz56B_55.css", { body: "body{color:teal}", contentType: "text/html" })
    const res = await (await app()).inject({ method: "GET", url: "/v1/site-assets/assets/index-Dz56B_55.css" })
    expect(res.statusCode).toBe(200)
    expect(res.body).toBe("body{color:teal}")
    expect(res.headers["content-type"]).toBe("text/css; charset=utf-8")
    expect(res.headers["cache-control"]).toBe("public, max-age=31536000, immutable")
    expect(res.headers["access-control-allow-origin"]).toBe("*")
    expect(res.headers["x-content-type-options"]).toBe("nosniff")
  })

  it("a probe gets the headers and the object is not downloaded", async () => {
    state.objects.set("site-assets/assets/index-Dz56B_55.css", { body: "body{color:teal}", contentType: "text/css" })
    const res = await (await app()).inject({ method: "HEAD", url: "/v1/site-assets/assets/index-Dz56B_55.css" })
    expect(res.statusCode).toBe(200)
    expect(res.headers["content-type"]).toBe("text/css; charset=utf-8")
    expect(res.body).toBe("")
    expect(state.streams.map((stream) => stream.destroyed)).toEqual([true])
  })

  it("a font keeps its own type", async () => {
    state.objects.set("site-assets/assets/geist-Ab12.woff2", { body: "wOF2", contentType: null })
    const res = await (await app()).inject({ method: "GET", url: "/v1/site-assets/assets/geist-Ab12.woff2" })
    expect(res.statusCode).toBe(200)
    expect(res.headers["content-type"]).toBe("font/woff2")
  })

  it("a name the archive does not have is a 404 nobody caches, and never HTML", async () => {
    const res = await (await app()).inject({ method: "GET", url: "/v1/site-assets/assets/index-Gone.css" })
    expect(res.statusCode).toBe(404)
    expect(res.headers["cache-control"]).toBe("no-store")
    expect(res.headers["content-type"]).toMatch(/^application\/json/)
  })

  it("a name the archive could never hold — a script, a way up — never reaches storage", async () => {
    const server = await app()
    for (const url of [
      "/v1/site-assets/assets/index-NewBuild.js",
      "/v1/site-assets/assets/..%2F..%2Fimages%2Fsecret.css",
      "/v1/site-assets/assets/index.html",
      "/v1/site-assets/assets/a/b.css",
      "/v1/site-assets/other/index-Dz56B_55.css",
      "/v1/site-assets/",
    ]) {
      const res = await server.inject({ method: "GET", url })
      expect(res.statusCode, url).toBe(404)
      expect(res.headers["cache-control"], url).toBe("no-store")
    }
    expect(streamR2Object).not.toHaveBeenCalled()
  })

  it("with the archive off, nothing is served and storage is not asked", async () => {
    state.enabled = false
    state.objects.set("site-assets/assets/index-Dz56B_55.css", { body: "body{}", contentType: "text/css" })
    const res = await (await app()).inject({ method: "GET", url: "/v1/site-assets/assets/index-Dz56B_55.css" })
    expect(res.statusCode).toBe(404)
    expect(streamR2Object).not.toHaveBeenCalled()
  })
})
