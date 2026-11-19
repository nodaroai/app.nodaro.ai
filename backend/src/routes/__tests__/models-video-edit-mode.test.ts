import { describe, it, expect, vi, beforeAll, afterAll } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"
import { VIDEO_TO_VIDEO_PROVIDERS } from "@nodaro/shared/models"

/**
 * GET /v1/models: the mode "v2v" lists the models that EDIT a clip, which is
 * what a client's "edit" menu reads. Wan 2.6 (`wan`) and Wan 2.6 Flash
 * (`wan-flash`) run on the Video to Video route but make a NEW clip featuring
 * the input video's subject, so neither is served with "v2v". `wan` keeps its
 * text-to-video listing; `wan-flash` is still listed, with no mode. Every
 * model that does edit a clip is served exactly as before.
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
  label: string
  modes: string[]
}

let app: FastifyInstance

async function served(query: string): Promise<ServedModel[]> {
  const res = await app.inject({ method: "GET", url: `/v1/models${query}` })
  expect(res.statusCode).toBe(200)
  const body = res.json() as { sections: { families: { models: ServedModel[] }[] }[] }
  return body.sections.flatMap((s) => s.families.flatMap((f) => f.models))
}

beforeAll(async () => {
  app = Fastify({ logger: false })
  await app.register(modelsRoutes)
  await app.ready()
})

afterAll(async () => {
  await app.close()
})

/** The models that edit a clip, each with the modes it is served with. */
const EDIT_MODELS: Readonly<Record<string, readonly string[]>> = {
  "seedance-2-5": ["i2v", "t2v", "v2v"],
  "seedance-2-5-flash": ["i2v", "t2v", "v2v"],
  "wan-videoedit": ["v2v"],
  "happyhorse-edit": ["v2v"],
  "luma-modify": ["v2v"],
  "runway-aleph": ["v2v"],
}

describe("GET /v1/models — which video models are edit models", () => {
  it("serves Wan 2.6 with its text-to-video mode only", async () => {
    const wan = (await served("?kind=video")).find((m) => m.id === "wan")
    expect(wan?.modes).toEqual(["t2v"])
  })

  it("serves Wan 2.6 Flash with no mode, under its own name", async () => {
    const flash = (await served("?kind=video")).find((m) => m.id === "wan-flash")
    expect(flash?.modes).toEqual([])
    expect(flash?.label).toBe("Wan 2.6 Flash")
  })

  it("keeps Wan 2.6 in the text-to-video list", async () => {
    expect((await served("?mode=t2v")).map((m) => m.id)).toContain("wan")
  })

  it.each(Object.entries(EDIT_MODELS))("serves %s as an edit model, its modes unchanged", async (id, modes) => {
    const model = (await served("?kind=video")).find((m) => m.id === id)
    expect(model?.modes).toEqual(modes)
  })

  it("?mode=v2v lists the models that edit a clip, and neither Wan 2.6 model", async () => {
    const ids = (await served("?mode=v2v")).map((m) => m.id)
    expect(ids).toEqual(expect.arrayContaining(Object.keys(EDIT_MODELS)))
    expect(ids).not.toContain("wan")
    expect(ids).not.toContain("wan-flash")
  })

  it("leaves both Wan 2.6 models on the Video to Video route's provider list", () => {
    expect(VIDEO_TO_VIDEO_PROVIDERS).toContain("wan")
    expect(VIDEO_TO_VIDEO_PROVIDERS).toContain("wan-flash")
  })
})
