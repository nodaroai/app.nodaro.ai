import { describe, it, expect, beforeAll, afterEach, vi } from "vitest"
import { buildApp } from "../../app.js"
import { __resetSurfaceProfileCacheForTests } from "../../lib/surface-profile.js"
import type { FastifyInstance } from "fastify"

// These cases are about which models list, not their prices. The prices come from
// the database through the billing module, and this app has no database: the
// real client would sit on the network until the test times out. Prices are
// pinned in nodes-charged-prices.test.ts and mcp/tools/__tests__/models.test.ts.
vi.mock("../../lib/pricing/charged-prices.js", () => ({
  loadChargedPrices: async () => ({ credits: () => undefined }),
}))

let app: FastifyInstance

beforeAll(async () => {
  app = await buildApp()
})

/**
 * GET /v1/models projects `{ sections: [{ kind, families: [{ models }] }] }`.
 * A denied model id must vanish from that projection. The filter reads the
 * profile per request, so the memoized profile is reset between cases (test
 * setup pins EDITION=cloud → business+ gate open).
 */
function modelIds(body: { sections: { families: { models: { id: string }[] }[] }[] }): string[] {
  return body.sections.flatMap((s) => s.families.flatMap((f) => f.models.map((m) => m.id)))
}

/**
 * #1332: with no `kind` filter the route grouped by family first and let the
 * family's first model pick the section, so every VEO / Seedance / Wan /
 * ByteDance video model shipped under "image". The invariant: a model sits in
 * the section of its own kind, filter or no filter.
 */
describe("GET /v1/models files every model under its own kind", () => {
  it("an unfiltered call puts VEO and Seedance under video, never under image", async () => {
    const body = (await app.inject({ method: "GET", url: "/v1/models" })).json() as {
      sections: { kind: string; families: { family: string; models: { id: string; kind?: string }[] }[] }[]
    }
    const idsOf = (kind: string) => body.sections.find((s) => s.kind === kind)?.families.flatMap((f) => f.models.map((m) => m.id)) ?? []
    expect(idsOf("video")).toEqual(expect.arrayContaining(["veo3", "seedance-2-5", "wan-3"]))
    expect(idsOf("image")).not.toEqual(expect.arrayContaining(["veo3"]))
    expect(idsOf("image")).not.toContain("seedance-2-5")
    // A mixed vendor appears once per kind it ships.
    expect(body.sections.find((s) => s.kind === "video")?.families.map((f) => f.family)).toContain("Google")
    expect(body.sections.find((s) => s.kind === "image")?.families.map((f) => f.family)).toContain("Google")
    // The unfiltered video section is the same set an explicit filter returns.
    const filtered = (await app.inject({ method: "GET", url: "/v1/models?kind=video" })).json()
    expect(idsOf("video").sort()).toEqual(modelIds(filtered).sort())
  }, 30_000)
})

describe("GET /v1/models honours models.deny (B1)", () => {
  afterEach(() => {
    delete process.env.NODARO_SURFACE_PROFILE
    __resetSurfaceProfileCacheForTests()
  })

  it("omits a denied model id from the projection", async () => {
    const before = (await app.inject({ method: "GET", url: "/v1/models?kind=video" })).json()
    const ids = modelIds(before)
    expect(ids.length).toBeGreaterThan(0)
    const victim = ids[0]

    process.env.NODARO_SURFACE_PROFILE = JSON.stringify({ models: { deny: [victim] } })
    __resetSurfaceProfileCacheForTests()

    const after = (await app.inject({ method: "GET", url: "/v1/models?kind=video" })).json()
    expect(modelIds(after)).not.toContain(victim)
  }, 30_000)
})
