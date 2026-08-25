/**
 * GET /v1/nodes discovery vs the 4b split, on a SELF-HOST:
 *   - truly cloud-only types (generative-pipeline) never list;
 *   - the Nodaro-exclusive types list iff the install is connected —
 *     the discovery contract must match what the relay can actually run;
 *   - /v1/nodes/:type answers 404 for an exclusive on an unconnected install
 *     (indistinguishable from absent, same as before 4b).
 * On cloud everything lists regardless of connection.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"

const mocks = vi.hoisted(() => ({
  hasCredits: vi.fn(() => false),
  isNodaroConnected: vi.fn(async () => false),
}))

// isBusiness/isCloud are needed by the surface-deny path (B1) that nodes.ts now
// consults; community defaults keep the surface gate closed → stock (no deny).
vi.mock("@/lib/config.js", () => ({
  hasCredits: mocks.hasCredits,
  isBusiness: () => false,
  isCloud: () => false,
}))
vi.mock("@/lib/nodaro-connect.js", () => ({ isNodaroConnected: mocks.isNodaroConnected }))
vi.mock("@/lib/node-registry.js", () => {
  const registry = [
    { type: "generate-image", label: "Generate Image", category: "ai", outputType: "image" },
    { type: "generate-video-pro", label: "Video Pro", category: "ai", outputType: "video" },
    { type: "video-analysis", label: "Video Analysis", category: "ai", outputType: "data" },
    { type: "generative-pipeline", label: "Generative Pipeline", category: "ai", outputType: "video" },
  ]
  return {
    getEnrichedRegistry: () => registry,
    findNode: (type: string) => registry.find((n) => n.type === type),
  }
})

import { nodesRoutes } from "../nodes.js"

let app: FastifyInstance

beforeEach(async () => {
  vi.clearAllMocks()
  mocks.hasCredits.mockReturnValue(false)
  mocks.isNodaroConnected.mockResolvedValue(false)
  app = Fastify({ logger: false })
  await app.register(async (i) => nodesRoutes(i))
  await app.ready()
})

afterEach(async () => {
  await app.close()
})

const listedTypes = async () => {
  const res = await app.inject({ method: "GET", url: "/v1/nodes" })
  return (res.json().data as Array<{ type: string }>).map((n) => n.type)
}

describe("self-host discovery", () => {
  it("unconnected: exclusives and cloud-only both absent", async () => {
    expect(await listedTypes()).toEqual(["generate-image"])
  })

  it("connected: exclusives list, cloud-only stays absent (no relay exists for it)", async () => {
    mocks.isNodaroConnected.mockResolvedValue(true)
    expect((await listedTypes()).sort()).toEqual(["generate-image", "generate-video-pro", "video-analysis"])
  })

  it("a connection-state read failure degrades to unconnected, never a 500", async () => {
    mocks.isNodaroConnected.mockRejectedValue(new Error("cache backend down"))
    const res = await app.inject({ method: "GET", url: "/v1/nodes" })
    expect(res.statusCode).toBe(200)
    expect((res.json().data as Array<{ type: string }>).map((n) => n.type)).toEqual(["generate-image"])
  })

  it("/v1/nodes/:type 404s an exclusive when unconnected, serves it when connected", async () => {
    let res = await app.inject({ method: "GET", url: "/v1/nodes/generate-video-pro" })
    expect(res.statusCode).toBe(404)
    mocks.isNodaroConnected.mockResolvedValue(true)
    res = await app.inject({ method: "GET", url: "/v1/nodes/generate-video-pro" })
    expect(res.statusCode).toBe(200)
    expect(res.json().data.type).toBe("generate-video-pro")
  })
})

describe("cloud discovery", () => {
  it("lists everything without consulting the connection", async () => {
    mocks.hasCredits.mockReturnValue(true)
    expect((await listedTypes()).sort()).toEqual([
      "generate-image",
      "generate-video-pro",
      "generative-pipeline",
      "video-analysis",
    ])
    expect(mocks.isNodaroConnected).not.toHaveBeenCalled()
  })
})
