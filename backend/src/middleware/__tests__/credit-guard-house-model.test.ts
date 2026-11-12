import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify"

/**
 * The house rule (lib/house-models-served.ts) withholds ONLY the house model:
 * it is no model restriction (`modelRestrictionConfigured` stays false), so a
 * deployment that does not serve it judges every other model exactly as one
 * with no house model. Where a request could run an unserved house model —
 * its body names one, outside the `provider` the deny judges first — the
 * guard asks `runModel` and refuses that model alone, before the handler and
 * any hold; a body that names none never has `runModel` asked (no default
 * model is a house model: house-models-tables.test.ts). Served, it runs.
 * Against a catalog with one own-label fixture.
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

const post = (extra: Record<string, unknown> = {}) =>
  app.inject({ method: "POST", url: "/v1/upscale", payload: { imageUrl: "https://in.example/a.png", ...extra } })

describe("the house rule withholds only the house model", () => {
  it("is no model restriction, served or not", () => {
    setPluginServices({})
    expect(modelRestrictionConfigured()).toBe(false)
    serving([])
    expect(modelRestrictionConfigured()).toBe(false)
    serving(["house-fixture", "nodaro-image-upscale"])
    expect(modelRestrictionConfigured()).toBe(false)
  })

  it("refuses, before the handler and any hold, a body that names an unserved house model the route runs through runModel", async () => {
    serving([])
    const res = await post({ model: "house-fixture" })
    expect(runModel).toHaveBeenCalled()
    expect(handled).toBe(0)
    expect(res.statusCode).toBe(403)
    expect(res.json()).toMatchObject({ error: { code: "model_not_available" } })
  })

  it("never asks runModel for a body that names no house model, and the route runs", async () => {
    serving([])
    const res = await post()
    expect(runModel).not.toHaveBeenCalled()
    expect(res.statusCode).toBe(200)
    expect(handled).toBe(1)
  })

  it("an answer that is not an unserved house model, or a throw, changes nothing", async () => {
    serving([])
    runModel.mockReturnValueOnce("z-image")
    expect((await post({ model: "house-fixture" })).statusCode).toBe(200)
    runModel.mockImplementationOnce(() => {
      throw new Error("bad body")
    })
    expect((await post({ model: "house-fixture" })).statusCode).toBe(200)
    expect(handled).toBe(2)
  })

  it("lets the same request run where the house model is served", async () => {
    serving(["house-fixture"])
    const res = await post({ model: "house-fixture" })
    expect(res.statusCode).toBe(200)
    expect(handled).toBe(1)
  })

  it("an install that serves every house model reads no body and never asks runModel", async () => {
    serving(["house-fixture", "nodaro-image-upscale"])
    const res = await post({ model: "house-fixture" })
    expect(res.statusCode).toBe(200)
    expect(runModel).not.toHaveBeenCalled()
  })
})
