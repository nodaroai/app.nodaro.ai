import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify"

/**
 * The house rule (lib/house-models-served.ts) counts as a model restriction
 * (`modelRestrictionConfigured`): with no profile and no override, a route
 * that runs a house model this install does not serve through `runModel` is
 * refused before its hold — the resolver is asked at all only because the
 * rule counts. Served, it runs. Against a catalog with one own-label fixture.
 */

vi.mock("@/lib/config.js", () => ({
  config: { EDITION: "business" },
  isBusiness: () => true,
  isCloud: () => false,
  isCommunity: () => false,
  hasCredits: () => false,
  hasAdmin: () => true,
}))
vi.mock("@/lib/supabase.js", () => ({ supabase: { from: vi.fn() } }))
vi.mock("@/lib/admin-check.js", () => ({ checkIsAdmin: async () => false, warmAdminCache: vi.fn() }))
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

import { creditGuard } from "../credit-guard.js"
import { modelRestrictionConfigured } from "../../lib/surface-deny.js"
import { setPluginServices } from "../../lib/private-plugins/services-registry.js"
import type { PluginHouseModelsService } from "../../lib/private-plugins/types.js"
import { resetOwnLabelModelIdsForTests } from "../../lib/house-models-served.js"

const USER = "00000000-0000-4000-8000-000000000001"

function serving(ids: readonly string[]): void {
  const service: PluginHouseModelsService = {
    ids: () => ids,
    plan: () => ({ providerCostUsd: 0 }),
    start: async () => ({ taskRef: "r" }),
    poll: async () => ({ state: "running" }),
  }
  setPluginServices({ houseModels: service })
}

let app: FastifyInstance
let handled: number
const runModel = vi.fn((_req: FastifyRequest): string | undefined => "house-fixture")

beforeEach(async () => {
  delete process.env.NODARO_SURFACE_PROFILE
  resetOwnLabelModelIdsForTests()
  runModel.mockClear()
  handled = 0
  app = Fastify({ logger: false })
  app.addHook("preHandler", async (req) => {
    ;(req as { userId?: string }).userId = USER
  })
  // Priced on an id that is no model: the model it runs is named only through `runModel`.
  app.post("/v1/upscale", { preHandler: creditGuard(() => "composite:2K", { runModel }) }, async () => {
    handled += 1
    return { ok: true }
  })
  await app.ready()
})
afterEach(async () => {
  await app.close()
  setPluginServices({})
  resetOwnLabelModelIdsForTests()
})

const post = () => app.inject({ method: "POST", url: "/v1/upscale", payload: { imageUrl: "https://in.example/a.png" } })

describe("the house rule is a model restriction", () => {
  it("counts while the catalog's house model is not served here, and not once it is", () => {
    setPluginServices({})
    expect(modelRestrictionConfigured()).toBe(true)
    serving([])
    expect(modelRestrictionConfigured()).toBe(true)
    serving(["house-fixture"])
    expect(modelRestrictionConfigured()).toBe(false)
  })

  it("refuses, before the handler and any hold, a route that runs an unserved house model through runModel", async () => {
    serving([])
    const res = await post()
    expect(runModel).toHaveBeenCalled()
    expect(handled).toBe(0)
    expect(res.statusCode).toBeGreaterThanOrEqual(400)
    expect(res.json()).toMatchObject({ error: { code: "model_not_available" } })
  })

  it("lets the same route run where the house model is served", async () => {
    serving(["house-fixture"])
    const res = await post()
    expect(res.statusCode).toBe(200)
    expect(handled).toBe(1)
  })
})
