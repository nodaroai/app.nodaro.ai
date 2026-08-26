import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"

/**
 * SAI-1 / H9 — models.deny / nodes.deny are enforced on the DIRECT generation
 * routes, not just at discovery + the DAG backstop.
 *
 * The deny lives in the core `creditGuard` preHandler (middleware/credit-guard.ts),
 * which every credit-spending generation route registers — so this exercises the
 * REAL creditGuard (NOT mocked) on minimal routes mounted at the REAL generation
 * paths, so `req.routeOptions.url` (the node-deny key) is the true pattern.
 *
 * Edition is mocked `business` (surfaceGateOpen() = isBusiness()||isCloud() = true)
 * with hasCredits()=false, so the surface profile applies AND the ee credit-guard
 * impl never loads — the real CORE shim runs standalone and the deny is the only
 * thing that can 403.
 */

vi.mock("@/lib/config.js", () => ({
  config: { EDITION: "business" },
  isBusiness: () => true,
  isCloud: () => false,
  isCommunity: () => false,
  hasCredits: () => false,
  hasAdmin: () => false,
}))

// The dedup fast-path only calls supabase when an idempotency-key header is
// present; these requests send none, so a bare stub is never reached.
vi.mock("@/lib/supabase.js", () => ({ supabase: { from: vi.fn() } }))

import { creditGuard } from "../../middleware/credit-guard.js"
import { __resetSurfaceProfileCacheForTests } from "../../lib/surface-profile.js"

const USER = "00000000-0000-4000-8000-000000000001"

/** Minimal routes at the REAL generation paths, guarded by the real creditGuard. */
const ROUTE_PATHS = [
  "/v1/generate-image",
  "/v1/generate-video",
  "/v1/text-to-video",
  "/v1/image-to-image",
  "/v1/text-to-speech",
] as const

async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false })
  app.addHook("preHandler", async (req) => {
    ;(req as { userId?: string }).userId = USER
  })
  for (const url of ROUTE_PATHS) {
    app.post(
      url,
      { preHandler: creditGuard((req) => (req.body as { provider?: string })?.provider ?? "default-provider") },
      async () => ({ ok: true }),
    )
  }
  await app.ready()
  return app
}

function setProfile(json: string | null): void {
  if (json === null) delete process.env.NODARO_SURFACE_PROFILE
  else process.env.NODARO_SURFACE_PROFILE = json
  __resetSurfaceProfileCacheForTests()
}

let app: FastifyInstance
beforeEach(async () => {
  app = await buildApp()
})
afterEach(async () => {
  await app.close()
  setProfile(null)
})

describe("models.deny on direct generation routes (the second front door)", () => {
  const cases = [
    { url: "/v1/generate-image", provider: "gpt-image" },
    { url: "/v1/generate-video", provider: "veo3" },
    // LOAD-BEARING: the deny reads the RAW body.provider, not the remapped
    // pricing id. A t2v "grok" is remapped to "grok-i2v" for pricing
    // (T2V_CREDIT_OVERRIDES), so any pricing-id-split design would miss the
    // denied "grok" here — this row fails under that mistake and passes only on
    // raw body.provider.
    { url: "/v1/text-to-video", provider: "grok" },
    { url: "/v1/image-to-image", provider: "flux" },
    { url: "/v1/text-to-speech", provider: "elevenlabs-v3" },
  ]
  for (const c of cases) {
    it(`403 model_not_available: ${c.provider} on ${c.url}`, async () => {
      setProfile(JSON.stringify({ models: { deny: [c.provider] } }))
      const res = await app.inject({ method: "POST", url: c.url, payload: { provider: c.provider } })
      expect(res.statusCode).toBe(403)
      expect(res.json().error.code).toBe("model_not_available")
    })
  }
})

describe("nodes.deny on direct generation routes", () => {
  it("403 node_not_available when the route's node type is denied", async () => {
    setProfile(JSON.stringify({ nodes: { deny: ["generate-video"] } }))
    const res = await app.inject({ method: "POST", url: "/v1/generate-video", payload: { provider: "veo3" } })
    expect(res.statusCode).toBe(403)
    expect(res.json().error.code).toBe("node_not_available")
  })
})

describe("inert when nothing is denied (byte-inert on mainline)", () => {
  it("no 403 with no surface profile at all", async () => {
    setProfile(null)
    const res = await app.inject({ method: "POST", url: "/v1/generate-video", payload: { provider: "veo3" } })
    expect(res.statusCode).not.toBe(403)
  })

  it("no 403 for a provider that is not the denied one", async () => {
    setProfile(JSON.stringify({ models: { deny: ["veo3"] } }))
    const res = await app.inject({ method: "POST", url: "/v1/generate-image", payload: { provider: "gpt-image" } })
    expect(res.statusCode).not.toBe(403)
  })
})
