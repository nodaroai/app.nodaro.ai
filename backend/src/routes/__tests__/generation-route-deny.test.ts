import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest"
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
  // Business has an admin panel — the admin-switch cases below depend on it.
  hasAdmin: () => true,
}))

// The dedup fast-path only calls supabase when an idempotency-key header is
// present; these requests send none, so a bare stub is never reached.
vi.mock("@/lib/supabase.js", () => ({ supabase: { from: vi.fn() } }))

// The admin switch (last block): who is an admin is the shared admin check —
// stubbed, because the real one reads `profiles`. `fail` is an outage.
const admins = vi.hoisted(() => ({ ids: new Set<string>(), fail: false }))
vi.mock("@/lib/admin-check.js", () => ({
  checkIsAdmin: async (userId: string) => {
    if (admins.fail) throw new Error("Admin check failed: db down")
    return admins.ids.has(userId)
  },
}))
// The gateable universe comes from the node registry, whose real module drags
// the whole credits graph in behind this file's config stub. Two rows are all
// an override needs to invert over.
vi.mock("@/lib/node-registry.js", () => ({
  NODE_REGISTRY: [
    { type: "generate-image", category: "ai-image" },
    { type: "generate-video", category: "ai-video" },
    { type: "web-scrape", category: "input" },
    { type: "instagram-scrape", category: "input" },
  ],
}))

import { creditGuard } from "../../middleware/credit-guard.js"
import { __resetSurfaceProfileCacheForTests } from "../../lib/surface-profile.js"
import { __resetAvailabilityOverridesForTests, __availabilityUniverseReadyForTests } from "../../lib/availability-override.js"

const USER = "00000000-0000-4000-8000-000000000001"

/** Minimal routes at the REAL generation paths, guarded by the real creditGuard. */
const ROUTE_PATHS = [
  "/v1/generate-image",
  "/v1/generate-video",
  "/v1/text-to-video",
  "/v1/image-to-image",
  "/v1/text-to-speech",
  "/v1/text-to-dialogue",
  "/v1/web-scrape",
] as const

async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false })
  // Only a user id — no `userRole`, no `authKind`: exactly what the
  // orchestrator's internal call carries, so nothing below can pass by reading
  // a role the JWT path stamped.
  app.addHook("preHandler", async (req) => {
    ;(req as { userId?: string }).userId = (req.headers["x-test-user"] as string | undefined) ?? USER
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

describe("the admin switch on direct generation routes — hidden from users, kept for admins", () => {
  const ADMIN = "00000000-0000-4000-8000-0000000000ad"
  beforeAll(() => __availabilityUniverseReadyForTests())
  beforeEach(() => {
    admins.ids = new Set([ADMIN])
    admins.fail = false
  })
  afterEach(() => __resetAvailabilityOverridesForTests())

  /** The stored override: generate-image stays on, generate-video is withheld. */
  const hideVideoFromUsers = () => __resetAvailabilityOverridesForTests({ nodes: new Set(["generate-image"]) })
  const postVideoAs = (user: string) =>
    app.inject({ method: "POST", url: "/v1/generate-video", headers: { "x-test-user": user }, payload: { provider: "veo3" } })

  it("refuses a user", async () => {
    hideVideoFromUsers()
    const res = await postVideoAs(USER)
    expect(res.statusCode).toBe(403)
    expect(res.json().error.code).toBe("node_not_available")
  })

  it("lets an admin through — keyed on the user id alone", async () => {
    hideVideoFromUsers()
    const res = await postVideoAs(ADMIN)
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ ok: true })
  })

  it("does not hand an admin back a node the deployment PROFILE removed", async () => {
    setProfile(JSON.stringify({ nodes: { deny: ["generate-video"] } }))
    const res = await postVideoAs(ADMIN)
    expect(res.statusCode).toBe(403)
    expect(res.json().error.code).toBe("node_not_available")
  })

  it("refuses an admin while the admin check is down — an outage never widens availability", async () => {
    hideVideoFromUsers()
    admins.fail = true
    const errors = vi.spyOn(console, "error").mockImplementation(() => {})
    const res = await postVideoAs(ADMIN)
    expect(res.statusCode).toBe(403)
    errors.mockRestore()
  })

  it("asks nobody's role for a node that is not hidden", async () => {
    hideVideoFromUsers()
    admins.fail = true // a lookup here would throw and be logged
    const errors = vi.spyOn(console, "error").mockImplementation(() => {})
    const res = await app.inject({ method: "POST", url: "/v1/generate-image", payload: { provider: "gpt-image" } })
    expect(res.statusCode).toBe(200)
    expect(errors).not.toHaveBeenCalled()
    errors.mockRestore()
  })
})

// Web Scrape's Instagram source is the Instagram node's capability behind another
// door, so it follows that node's availability. The guard reads it from the BODY.
describe("a capability hosted by another route follows the node that governs it", () => {
  const ADMIN = "00000000-0000-4000-8000-0000000000ad"
  beforeAll(() => __availabilityUniverseReadyForTests())
  beforeEach(() => {
    admins.ids = new Set([ADMIN])
    admins.fail = false
    // The Instagram NODE is withheld; Web Scrape itself stays released.
    __resetAvailabilityOverridesForTests({ nodes: new Set(["generate-image", "generate-video", "web-scrape"]) })
  })
  afterEach(() => __resetAvailabilityOverridesForTests())

  const scrapeAs = (user: string, actor: string) =>
    app.inject({ method: "POST", url: "/v1/web-scrape", headers: { "x-test-user": user }, payload: { actor, target: "nasa" } })

  it("refuses a user the Instagram source, naming it", async () => {
    const res = await scrapeAs(USER, "instagram")
    expect(res.statusCode).toBe(403)
    expect(res.json().error.code).toBe("node_not_available")
    expect(res.json().error.message).toContain("web-scrape:instagram")
  })

  it("lets an admin use it", async () => {
    expect((await scrapeAs(ADMIN, "instagram")).statusCode).toBe(200)
  })

  it("leaves Web Scrape's other sources alone", async () => {
    for (const actor of ["google-search", "content-crawler", "tiktok", "rss"]) {
      expect((await scrapeAs(USER, actor)).statusCode).toBe(200)
    }
  })

  it("the source is back for everyone once the Instagram node is released", async () => {
    __resetAvailabilityOverridesForTests()
    expect((await scrapeAs(USER, "instagram")).statusCode).toBe(200)
  })
})

// A one-off voice clone (Gemini 3.8 Flash) is voice cloning behind the speech routes' door (decided
// 2026-11-13): a deployment that denies the Voice Clone node refuses it there, before anything is held or read.
describe("a one-off voice clone follows the Voice Clone node", () => {
  const REPLICA = { sourceAudioUrl: "https://media.example/s.wav", consentAudioUrl: "https://media.example/c.wav" }
  const denyVoiceClone = () => setProfile(JSON.stringify({ nodes: { deny: ["voice-clone"] } }))

  it("refuses Text to Speech and Text to Dialogue with a clone, naming it, where voice-clone is denied", async () => {
    denyVoiceClone()
    const tts = await app.inject({ method: "POST", url: "/v1/text-to-speech", payload: { provider: "gemini-3-8-flash-tts", text: "Hi.", replica: REPLICA } })
    expect(tts.statusCode).toBe(403)
    expect(tts.json().error.code).toBe("node_not_available")
    expect(tts.json().error.message).toContain("a one-off voice clone")
    const dlg = await app.inject({
      method: "POST",
      url: "/v1/text-to-dialogue",
      payload: { provider: "gemini-3-8-flash-tts", dialogue: [{ text: "Hi.", voice: "Me" }], speakers: [{ voice: "Me", replica: REPLICA }] },
    })
    expect(dlg.statusCode).toBe(403)
    expect(dlg.json().error.message).toContain("a one-off voice clone")
  })

  it("leaves speech without a clone alone there, and a clone alone where voice-clone is offered", async () => {
    denyVoiceClone()
    expect((await app.inject({ method: "POST", url: "/v1/text-to-speech", payload: { provider: "gemini-3-8-flash-tts", text: "Hi." } })).statusCode).toBe(200)
    setProfile(null)
    expect((await app.inject({ method: "POST", url: "/v1/text-to-speech", payload: { provider: "gemini-3-8-flash-tts", text: "Hi.", replica: REPLICA } })).statusCode).toBe(200)
  })
})

