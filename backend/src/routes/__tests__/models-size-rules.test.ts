import { describe, it, expect, vi, beforeAll, afterAll } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"
import { MODEL_CATALOG } from "@nodaro/shared/model-catalog"

/**
 * GET /v1/models — the size rules of a capability sheet: the sizes a ratio
 * renders (`resolutionsByAspectRatio`), the one size a transparent background
 * renders at (`transparentResolution`) and whether a background setting is
 * taken only at that size (`backgroundOnlyAtTransparentResolution`). Each is
 * served exactly as the catalog declares it, on the models that declare it,
 * and left out everywhere else, so a client that reads only the SDK knows
 * that GPT Image 2.5 renders 27:16, 16:27, 9:8 and 8:9 at 1K only.
 */

// Not about prices or marks: both read the database, which this test has none of.
vi.mock("../../lib/pricing/charged-prices.js", () => ({
  loadChargedPrices: async () => ({ credits: () => undefined, rate: () => undefined }),
}))
vi.mock("../../lib/maker-logos.js", () => ({ makerLogoUrls: async () => new Map() }))
vi.mock("../../lib/supabase.js", () => ({
  supabase: { from: () => ({ select: async () => ({ data: [], error: null }) }) },
}))

const { modelsRoutes } = await import("../models.js")

interface ServedModel {
  id: string
  resolutions?: string[]
  resolutionsByAspectRatio?: Record<string, string[]>
  transparentResolution?: string
  backgroundOnlyAtTransparentResolution?: true
}

let app: FastifyInstance
let served: ServedModel[]

beforeAll(async () => {
  app = Fastify({ logger: false })
  await app.register(modelsRoutes)
  await app.ready()
  const res = await app.inject({ method: "GET", url: "/v1/models" })
  expect(res.statusCode).toBe(200)
  const body = res.json() as { sections: { families: { models: ServedModel[] }[] }[] }
  served = body.sections.flatMap((s) => s.families.flatMap((f) => f.models))
})

afterAll(async () => {
  await app.close()
})

const byId = (id: string) => {
  const m = served.find((x) => x.id === id)
  if (!m) throw new Error(`${id} is not listed`)
  return m
}

const GPT_IMAGE_2_5 = ["gpt-image-2-5-flare", "gpt-image-2-5-sunburst", "gpt-image-2-5-flare-i2i", "gpt-image-2-5-sunburst-i2i"]
const GPT_IMAGE_2_6_TRANSPARENT_1K = ["gpt-image-2-6-flare", "gpt-image-2-6-sunburst", "gpt-image-2-6-flare-i2i", "gpt-image-2-6-sunburst-i2i"]

describe("GET /v1/models — the sizes a ratio renders", () => {
  it.each(GPT_IMAGE_2_5)("%s renders 27:16, 16:27, 9:8 and 8:9 at 1K only", (id) => {
    const m = byId(id)
    expect(m.resolutionsByAspectRatio).toEqual({ "27:16": ["1K"], "16:27": ["1K"], "9:8": ["1K"], "8:9": ["1K"] })
    expect(m.resolutions).toEqual(["1K", "2K", "4K"])
  })

  it("is served exactly as the catalog declares it, and left out on every other model", () => {
    expect(served.length).toBeGreaterThan(50)
    const carrying = served.filter((m) => m.resolutionsByAspectRatio !== undefined).map((m) => m.id)
    expect(carrying.sort()).toEqual(
      served.filter((m) => MODEL_CATALOG[m.id]?.resolutionsByAspectRatio !== undefined).map((m) => m.id).sort(),
    )
    expect(carrying).toEqual(expect.arrayContaining(GPT_IMAGE_2_5))
    for (const m of served) {
      const declared = MODEL_CATALOG[m.id]?.resolutionsByAspectRatio
      if (declared) expect(m.resolutionsByAspectRatio, m.id).toEqual(declared)
      else expect(m, m.id).not.toHaveProperty("resolutionsByAspectRatio")
    }
  })

  it("a model with no such rule (GPT Image 2.6, Nano Banana Pro) carries no field", () => {
    for (const id of ["gpt-image-2-6-flare", "gpt-image-2-6-flare-i2i", "nano-banana-pro"]) {
      expect(byId(id), id).not.toHaveProperty("resolutionsByAspectRatio")
    }
  })
})

describe("GET /v1/models — the transparent background's size", () => {
  it.each([...GPT_IMAGE_2_5, ...GPT_IMAGE_2_6_TRANSPARENT_1K])("%s renders a transparent background at 1K", (id) => {
    expect(byId(id).transparentResolution).toBe("1K")
  })

  it("GPT Image 2.5 takes a background setting only at that size; GPT Image 2.6 at every size", () => {
    for (const id of GPT_IMAGE_2_5) expect(byId(id).backgroundOnlyAtTransparentResolution, id).toBe(true)
    for (const id of GPT_IMAGE_2_6_TRANSPARENT_1K) expect(byId(id), id).not.toHaveProperty("backgroundOnlyAtTransparentResolution")
  })

  it("both are served exactly as the catalog declares them, and left out on every other model", () => {
    for (const m of served) {
      const entry = MODEL_CATALOG[m.id]
      if (entry?.transparentResolution !== undefined) expect(m.transparentResolution, m.id).toBe(entry.transparentResolution)
      else expect(m, m.id).not.toHaveProperty("transparentResolution")
      if (entry?.backgroundOnlyAtTransparentResolution) expect(m.backgroundOnlyAtTransparentResolution, m.id).toBe(true)
      else expect(m, m.id).not.toHaveProperty("backgroundOnlyAtTransparentResolution")
    }
  })
})
