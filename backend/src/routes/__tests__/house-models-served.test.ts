/**
 * GET /v1/house-models/internal/served — the standalone orchestrator's door to
 * which house models this deployment serves (it loads no plugin; this process
 * loaded them). Internal only: never a user, an app token or an API key.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"

vi.mock("@nodaro/shared/model-catalog", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@nodaro/shared/model-catalog")>()
  return {
    ...actual,
    MODEL_CATALOG: {
      ...actual.MODEL_CATALOG,
      "house-fixture": {
        id: "house-fixture", kind: "image", modes: ["upscale"], family: "House Fixture", ownLabel: true,
        label: "House Fixture", series: "House Fixture", description: "A fixture.", useCases: [], pricing: [{ identifier: "house-fixture", credits: 1 }],
      },
    },
  }
})

import { houseModelsServedRoutes } from "../house-models-served.js"
import { _resetPluginServicesForTests, setPluginServices } from "../../lib/private-plugins/services-registry.js"
import { resetOwnLabelModelIdsForTests } from "../../lib/house-models-served.js"

const URL = "/v1/house-models/internal/served"
let app: FastifyInstance
let ids: () => readonly string[]

beforeEach(async () => {
  _resetPluginServicesForTests()
  resetOwnLabelModelIdsForTests()
  ids = vi.fn(() => ["house-fixture", "z-image"])
  setPluginServices({ houseModels: { ids: () => ids(), plan: () => null, start: vi.fn(), poll: vi.fn() } })
  app = Fastify({ logger: false })
  app.addHook("preHandler", async (req) => {
    if (req.headers["x-internal"] === "1") req.authKind = "internal"
    if (req.headers["x-jwt"] === "1") req.authKind = "jwt"
  })
  await app.register(houseModelsServedRoutes)
  await app.ready()
})
afterEach(async () => {
  await app.close()
  _resetPluginServicesForTests()
})

describe("GET /v1/house-models/internal/served", () => {
  it("refuses every caller but the internal one, before reading anything", async () => {
    for (const headers of [{}, { "x-jwt": "1" }]) {
      const res = await app.inject({ method: "GET", url: URL, headers })
      expect(res.statusCode).toBe(403)
      expect(res.json()).toEqual({ error: { code: "forbidden", message: "Internal only" } })
    }
    expect(ids).not.toHaveBeenCalled()
  })

  it("answers the own-label ids the loaded plugin serves, and nothing else", async () => {
    const res = await app.inject({ method: "GET", url: URL, headers: { "x-internal": "1" } })
    expect(res.statusCode).toBe(200)
    // A plugin can only narrow the set: an id the catalog does not mark own-label is never answered.
    expect(res.json()).toEqual({ ids: ["house-fixture"] })
    expect(res.headers["cache-control"]).toBe("no-store")
  })

  it("answers none when the plugin serves none (no upstream key here)", async () => {
    ids = () => []
    const res = await app.inject({ method: "GET", url: URL, headers: { "x-internal": "1" } })
    expect(res.json()).toEqual({ ids: [] })
  })
})
