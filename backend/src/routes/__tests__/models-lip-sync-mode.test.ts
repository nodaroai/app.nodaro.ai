import { describe, it, expect, vi, beforeAll, afterAll } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"
import { LIP_SYNC_PROVIDERS } from "@nodaro/shared/models"

/**
 * GET /v1/models?mode=lip-sync lists every model the Lip Sync node takes
 * (decided 2026-11-24): the lip-sync models, then the video models it runs a
 * portrait and a voice through. Those are served with their own video modes:
 * an entry says what the model does, not which node runs it.
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

const ADDED = ["seedance-2", "seedance-2-fast", "seedance-2-mini", "seedance-2-5", "seedance-2-5-flash", "minimax-h3", "ltx-2.5-fast"]

describe("GET /v1/models?mode=lip-sync", () => {
  it("lists every model the Lip Sync node takes, LTX 2.5 Fast among them", async () => {
    const ids = (await served("?mode=lip-sync")).map((m) => m.id)
    for (const id of LIP_SYNC_PROVIDERS) expect(ids, id).toContain(id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it("serves the added video models with their own modes, and lists them under no other filter they lacked", async () => {
    const models = await served("?mode=lip-sync")
    for (const id of ADDED) expect(models.find((m) => m.id === id)?.modes, id).not.toContain("lip-sync")
    const t2v = (await served("?mode=t2v")).map((m) => m.id)
    expect(t2v).toContain("ltx-2.5-fast")
    expect((await served("?mode=v2v")).map((m) => m.id)).not.toContain("ltx-2.5-fast")
  })
})
