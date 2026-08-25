import { describe, it, expect, beforeAll, afterEach } from "vitest"
import { buildApp } from "../../app.js"
import { __resetSurfaceProfileCacheForTests } from "../../lib/surface-profile.js"
import type { FastifyInstance } from "fastify"

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
